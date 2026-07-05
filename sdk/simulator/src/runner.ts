import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright';
import type { LoadPhaseSnapshot } from './tracer.js';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join }                   from 'node:path';
import type { SimulatorConfig, SessionReport, NetworkProfile, ViewportProfile } from '@vitalsage/types';
import { INJECTOR_SCRIPT }        from './injector.js';
import { NETWORK_PROFILES, VIEWPORT_PROFILES } from './profiles.js';
import { extractSessionReport, collectPageContext } from './extractor.js';
import { parseFunctionsFromProfile, parseScriptsFromProfile, type CpuProfileData } from './trace-parser.js';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** A profile dir is "fresh" if it doesn't exist yet or is empty. */
async function isProfileEmpty(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    return true;   // doesn't exist yet
  }
}

interface RunSpec {
  network:  NetworkProfile;
  viewport: ViewportProfile;
  route:    string;
}

/** A provisioned page for one run, plus how to release it afterward. */
interface RunEnv {
  context: BrowserContext;
  page:    Page;
  release: () => Promise<void>;
}

function buildRunPlan(config: SimulatorConfig): RunSpec[] {
  const networks  = config.networks  ?? ['4g', '3g', 'slow-2g'];
  const viewports = config.viewports ?? ['desktop', 'mobile'];
  const routes    = config.routes    ?? ['/'];

  const combinations: RunSpec[] = networks.flatMap(n =>
    viewports.flatMap(v => routes.map(r => ({ network: n, viewport: v, route: r })))
  );

  const plan: RunSpec[] = [];
  for (let i = 0; i < config.runs; i++) {
    plan.push(combinations[i % combinations.length]!);
  }
  return plan;
}

export class PlaywrightSimulator {
  async simulate(config: SimulatorConfig): Promise<SessionReport[]> {
    await mkdir(config.outputDir, { recursive: true });

    const usePersistent = !!config.userDataDir;
    // A persistent profile is a single browser session — running pages in
    // parallel would share/clobber cookies. Serialize when reusing a profile.
    const concurrency = usePersistent ? 1 : (config.concurrency ?? 3);

    const channelOpt = config.browserChannel ? { channel: config.browserChannel } : {};

    let browser:       Browser | undefined;
    let persistentCtx: BrowserContext | undefined;
    let effectiveHeaded = !!config.headed;

    if (usePersistent) {
      const fresh  = await isProfileEmpty(config.userDataDir!);
      // Auto-headed the first time so the user can see the window and log in.
      effectiveHeaded = config.headed || fresh;
      persistentCtx = await chromium.launchPersistentContext(config.userDataDir!, {
        headless: !effectiveHeaded,
        ...channelOpt,
      });

      // Fresh profile → open the target URL and pause for sign-in before
      // measuring, so authenticated routes are reachable on the runs that follow.
      if (fresh && config.onProfileInit) {
        const setupPage = await persistentCtx.newPage();
        await setupPage.goto(config.url, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        await config.onProfileInit();
        await setupPage.close().catch(() => {});
      }
    } else {
      browser = await chromium.launch({ headless: !config.headed, ...channelOpt });
    }

    // Announce which browser actually ran so users can confirm they're on the
    // local/system browser vs the bundled Chromium. Uses the [VitalSage] prefix
    // (not [VitalSage Simulator]) so it survives the trace/capture log filters.
    const activeBrowser = persistentCtx?.browser() ?? browser;
    const engineLabel   = config.browserChannel
      ? `system browser '${config.browserChannel}'`
      : 'bundled Chromium';
    console.log(
      `[VitalSage] Browser: ${engineLabel} v${activeBrowser?.version() ?? 'unknown'}` +
      ` · ${effectiveHeaded ? 'headed' : 'headless'}` +
      (config.userDataDir ? ` · profile: ${config.userDataDir}` : ' · ephemeral profile'),
    );

    // Per-run page provisioning. Persistent mode reuses the one authenticated
    // context (new page each run); default mode gets a fresh isolated context.
    const provision = async (run: RunSpec): Promise<RunEnv> => {
      const vp = VIEWPORT_PROFILES[run.viewport];
      if (persistentCtx) {
        const page = await persistentCtx.newPage();
        await page.setViewportSize({ width: vp.width, height: vp.height }).catch(() => {});
        return { context: persistentCtx, page, release: async () => { await page.close().catch(() => {}); } };
      }
      const context = await browser!.newContext({
        viewport:          { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        isMobile:          vp.isMobile,
        hasTouch:          vp.hasTouch,
      });
      const page = await context.newPage();
      return { context, page, release: async () => { await context.close().catch(() => {}); } };
    };

    const sessions:   SessionReport[] = [];
    const errors:     Error[] = [];
    const plan        = buildRunPlan(config);
    const delay = config.delayBetweenRuns ?? 0;

    for (let i = 0; i < plan.length; i += concurrency) {
      if (i > 0 && delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const chunk   = plan.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map(async run => {
          const env = await provision(run);
          return this.executeRun(env, config, run);
        })
      );

      results.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value) {
          sessions.push(r.value);
        } else if (r.status === 'rejected') {
          errors.push(new Error(`Run ${i + idx} failed: ${String(r.reason)}`));
        }
      });

      console.log(`[VitalSage Simulator] ${Math.min(i + concurrency, plan.length)}/${plan.length} runs complete`);
    }

    if (persistentCtx) await persistentCtx.close().catch(() => {});
    else               await browser!.close().catch(() => {});

    if (errors.length > 0) {
      console.warn(`[VitalSage Simulator] ${errors.length} runs failed:`, errors.map(e => e.message));
    }

    await this.writeSessions(sessions, config.outputDir);
    return sessions;
  }

  private async executeRun(
    env:     RunEnv,
    config:  SimulatorConfig,
    run:     RunSpec,
  ): Promise<SessionReport | null> {
    const vp      = VIEWPORT_PROFILES[run.viewport];
    const { context, page } = env;

    // Single page-level CDP session for network throttling, Performance.getMetrics,
    // and the V8 Profiler domain.
    //
    // NOTE: We intentionally do NOT use CDP Tracing.start/stop — Playwright
    // intercepts the Tracing domain internally (for context.tracing) and blocks
    // external use: Tracing.start silently no-ops and Tracing.stop returns
    // "Tracing.stop wasn't found". The Profiler domain gives the same V8 CPU
    // sample data and works correctly on page-level CDP sessions.
    let mainCdp:       CDPSession | undefined;
    let profilerStarted = false;  // hoisted so finally block can clean up on early throw
    try {
      await page.addInitScript({ content: INJECTOR_SCRIPT });

      mainCdp = await context.newCDPSession(page);
      await mainCdp.send('Network.enable');
      await mainCdp.send('Network.emulateNetworkConditions', NETWORK_PROFILES[run.network]);

      // Mobile means a slower CPU, not just a narrow screen — without
      // throttling, "mobile" runs measure desktop CPU behind a mobile
      // viewport and under-detect JS/rendering bottlenecks.
      if (vp.isMobile) {
        await mainCdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }

      if (config.captureTrace) {
        await mainCdp.send('Performance.enable');
        await mainCdp.send('Profiler.enable');

        // Set sampling interval:
        //   captureFullTrace → 1000 µs (1 ms, same default as Chrome DevTools)
        //   captureTrace only → 5000 µs (5 ms, lower overhead for routine runs)
        await mainCdp.send('Profiler.setSamplingInterval', {
          interval: config.captureFullTrace ? 1000 : 5000,
        });

        await mainCdp.send('Profiler.start');
        profilerStarted = true;
      }

      const url = run.route === '/'
        ? config.url
        : config.url.replace(/\/$/, '') + run.route;

      // Try networkidle first (best measurement window). Many production sites
      // with persistent XHR/WebSocket connections never reach networkidle, so we
      // fall back to 'load' + a short networkidle grace period on timeout.
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      } catch {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        // Give the page a short window to settle after load before we snapshot.
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      }

      // Stop profiler and snapshot Performance.getMetrics at the same settled point
      // so both data sources reflect the same load phase window.
      let loadPhase: LoadPhaseSnapshot | undefined;
      if (config.captureTrace && mainCdp && profilerStarted) {
        const [profilerResult, { metrics }, longTasks] = await Promise.all([
          mainCdp.send('Profiler.stop') as Promise<{ profile: CpuProfileData }>,
          mainCdp.send('Performance.getMetrics') as Promise<{ metrics: Array<{ name: string; value: number }> }>,
          page.evaluate(() => {
            type E = { startTime: number; duration: number; blocking: number };
            const s = (window as unknown as { __vitalsage_session?: { longTasks?: E[] } }).__vitalsage_session;
            return s?.longTasks ? [...s.longTasks] as E[] : [] as E[];
          }),
        ]);
        profilerStarted = false;

        const profile      = profilerResult.profile;
        const topScripts   = parseScriptsFromProfile(profile);
        const topFunctions = config.captureFullTrace ? parseFunctionsFromProfile(profile) : undefined;

        loadPhase = {
          metrics:  Object.fromEntries(metrics.map(m => [m.name, m.value])),
          longTasks,
          topScripts,
          ...(topFunctions ? { topFunctions } : {}),
        };
      }

      await page.waitForTimeout(config.waitAfterLoad ?? 3000);

      // Snapshot the page context at the load-settled point, BEFORE the
      // interaction phase mutates the DOM (lazy-loaded content inflates
      // domNodeCount and shifts above-fold classification).
      const preContext = await page.evaluate(collectPageContext);

      if (config.interactAfterLoad !== false) {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(300);
        // Interact without risking navigation: buttons only, never a[href] —
        // clicking a link navigated away mid-measurement and destroyed the
        // injected session state.
        const urlBefore  = page.url();
        const clickable  = await page.$('button:not([type="submit"]), [role="button"]');
        if (clickable) {
          await clickable.click({ timeout: 1000 }).catch(() => {});
        } else {
          // Synthetic tap so INP has at least one interaction to measure.
          await page.evaluate(() => {
            for (const type of ['pointerdown', 'pointerup'] as const) {
              document.body.dispatchEvent(new PointerEvent(type, { bubbles: true }));
            }
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }).catch(() => {});
        }
        await page.waitForTimeout(300);
        if (page.url() !== urlBefore) {
          console.warn('[VitalSage Simulator] Interaction caused navigation — metrics may be incomplete');
        }
      }

      let screenshot: string | undefined;
      if (config.captureTrace) {
        const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
        screenshot = buf.toString('base64');
      }

      return await extractSessionReport(
        page, url, run.network, run.viewport, generateId(),
        config.captureTrace ?? false, mainCdp, screenshot, loadPhase, preContext,
      );
    } catch (err) {
      console.warn(`[VitalSage Simulator] Run failed (${run.network}/${run.viewport}/${run.route}):`, err);
      return null;
    } finally {
      // If the run threw before Profiler.stop was called, stop it now so the
      // profiler doesn't keep running and leaking memory into subsequent runs.
      if (profilerStarted && mainCdp) {
        await mainCdp.send('Profiler.stop').catch(() => {});
      }
      await mainCdp?.detach().catch(() => {});
      await env.release();
    }
  }

  private async writeSessions(sessions: SessionReport[], dir: string): Promise<void> {
    await Promise.all(
      sessions.map(s =>
        writeFile(join(dir, `session-${s.sessionId}.json`), JSON.stringify(s, null, 2))
      )
    );
    console.log(`[VitalSage Simulator] Wrote ${sessions.length} sessions to ${dir}`);
  }
}
