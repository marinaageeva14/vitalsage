import { chromium, type Browser } from 'playwright';
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

    for (let i = 0; i < plan.length; i += concurrency) {
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

    // Network emulation via CDP
    const tempPage = await context.newPage();
    const cdp      = await context.newCDPSession(tempPage);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', NETWORK_PROFILES[run.network]);
    await cdp.detach();
    await tempPage.close();

    const page = await context.newPage();
    try {
      await page.addInitScript({ content: INJECTOR_SCRIPT });

      const url = run.route === '/'
        ? config.url
        : config.url.replace(/\/$/, '') + run.route;

      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
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

      return await extractSessionReport(page, url, run.network, run.viewport, generateId(), config.captureTrace ?? false);
    } catch (err) {
      console.warn(`[VitalSage Simulator] Run failed (${run.network}/${run.viewport}/${run.route}):`, err);
      return null;
    } finally {
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
