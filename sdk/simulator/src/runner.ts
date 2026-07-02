import { chromium, type Browser, type CDPSession } from 'playwright';
import type { LoadPhaseSnapshot } from './tracer.js';
import { mkdir, writeFile }       from 'node:fs/promises';
import { join }                   from 'node:path';
import type { SimulatorConfig, SessionReport, NetworkProfile, ViewportProfile } from '@vitalsage/types';
import { INJECTOR_SCRIPT }        from './injector.js';
import { NETWORK_PROFILES, VIEWPORT_PROFILES } from './profiles.js';
import { extractSessionReport, collectPageContext } from './extractor.js';
import { parseFunctionsFromProfile, parseScriptsFromProfile, type CpuProfileData } from './trace-parser.js';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface RunSpec {
  network:  NetworkProfile;
  viewport: ViewportProfile;
  route:    string;
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

    const browser     = await chromium.launch({ headless: true });
    const concurrency = config.concurrency ?? 3;
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
        chunk.map(run => this.executeRun(browser, config, run))
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

    await browser.close();

    if (errors.length > 0) {
      console.warn(`[VitalSage Simulator] ${errors.length} runs failed:`, errors.map(e => e.message));
    }

    await this.writeSessions(sessions, config.outputDir);
    return sessions;
  }

  private async executeRun(
    browser: Browser,
    config:  SimulatorConfig,
    run:     RunSpec,
  ): Promise<SessionReport | null> {
    const vp      = VIEWPORT_PROFILES[run.viewport];
    const context = await browser.newContext({
      viewport:          { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile:          vp.isMobile,
      hasTouch:          vp.hasTouch,
    });

    const page = await context.newPage();
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
      await context.close().catch(() => {});
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
