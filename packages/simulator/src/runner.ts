import { chromium, type Browser, type CDPSession } from 'playwright';
import type { LoadPhaseSnapshot } from './tracer.js';
import { mkdir, writeFile }       from 'node:fs/promises';
import { join }                   from 'node:path';
import type { SimulatorConfig, SessionReport, NetworkProfile, ViewportProfile } from '@vitalsage/types';
import { INJECTOR_SCRIPT }        from './injector.js';
import { NETWORK_PROFILES, VIEWPORT_PROFILES } from './profiles.js';
import { extractSessionReport }   from './extractor.js';

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
    // Single CDP session kept open for the whole run:
    // – network throttling (must stay open or Chrome reverts conditions on detach)
    // – performance counters (when captureTrace)
    let mainCdp: CDPSession | undefined;
    try {
      await page.addInitScript({ content: INJECTOR_SCRIPT });

      mainCdp = await context.newCDPSession(page);
      await mainCdp.send('Network.enable');
      await mainCdp.send('Network.emulateNetworkConditions', NETWORK_PROFILES[run.network]);
      if (config.captureTrace) {
        await mainCdp.send('Performance.enable');
      }

      const url = run.route === '/'
        ? config.url
        : config.url.replace(/\/$/, '') + run.route;

      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

      // Snapshot immediately at networkidle so that timing counters, TBT, and
      // long tasks all reflect the same load-phase window (comparable to DevTools).
      let loadPhase: LoadPhaseSnapshot | undefined;
      if (config.captureTrace && mainCdp) {
        const [{ metrics }, longTasks] = await Promise.all([
          mainCdp.send('Performance.getMetrics') as Promise<{ metrics: Array<{ name: string; value: number }> }>,
          page.evaluate(() => {
            type E = { startTime: number; duration: number; blocking: number };
            const s = (window as unknown as { __vitalsage_session?: { longTasks?: E[] } }).__vitalsage_session;
            return s?.longTasks ? [...s.longTasks] as E[] : [] as E[];
          }),
        ]);
        loadPhase = {
          metrics:   Object.fromEntries(metrics.map(m => [m.name, m.value])),
          longTasks,
        };
      }

      await page.waitForTimeout(config.waitAfterLoad ?? 3000);

      if (config.interactAfterLoad !== false) {
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await page.waitForTimeout(300);
        const clickable = await page.$('button, a[href], [role="button"]');
        if (clickable) {
          await clickable.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      }

      let screenshot: string | undefined;
      if (config.captureTrace) {
        const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
        screenshot = buf.toString('base64');
      }

      return await extractSessionReport(
        page, url, run.network, run.viewport, generateId(),
        config.captureTrace ?? false, mainCdp, screenshot, loadPhase,
      );
    } catch (err) {
      console.warn(`[VitalSage Simulator] Run failed (${run.network}/${run.viewport}/${run.route}):`, err);
      return null;
    } finally {
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
