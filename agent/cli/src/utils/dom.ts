/**
 * DOM inspection utility for the `vitalsage fix` command.
 *
 * Navigates to a URL with Playwright and extracts performance-relevant
 * DOM-level intelligence:
 *   - LCP element (tag, src, size, classes)
 *   - Render-blocking resources (scripts/stylesheets without async/defer)
 *   - CLS contributors (elements that shifted during load)
 *   - Third-party scripts
 */
import { chromium } from 'playwright';

export interface LcpElement {
  tag:         string;
  id:          string | null;
  classes:     string[];
  src:         string | null;
  textPreview: string | null;
  width:       number;
  height:      number;
  isAboveFold: boolean;
}

export interface BlockingResource {
  tag:    'script' | 'link';
  src:    string;
  reason: string;
}

export interface ClsContributor {
  selector: string;
  shift:    number;
  rect:     { x: number; y: number; width: number; height: number };
}

export interface ThirdPartyScript {
  src:    string;
  origin: string;
  async:  boolean;
  defer:  boolean;
}

export interface DomFindings {
  url:               string;
  lcpElement:        LcpElement | null;
  blockingResources: BlockingResource[];
  clsContributors:   ClsContributor[];
  thirdPartyScripts: ThirdPartyScript[];
  durationMs:        number;
}

const NETWORK_PROFILES = {
  '4g': { offline: false, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8, latency: 20 },
  '3g': { offline: false, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 100 },
};

const VIEWPORT_SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile:  { width: 390,  height: 844 },
};

export async function inspectDom(
  url:      string,
  network:  '4g' | '3g' = '4g',
  viewport: 'desktop' | 'mobile' = 'desktop',
  waitMs:   number = 5000,
): Promise<DomFindings> {
  const t0 = Date.now();
  const vp = VIEWPORT_SIZES[viewport];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: vp, isMobile: viewport === 'mobile' });
  const page    = await context.newPage();
  const cdp     = await context.newCDPSession(page);

  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', NETWORK_PROFILES[network]);

    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__lcpEl   = null;
      (window as unknown as Record<string, unknown>).__clsData = [];

      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const e = entry as PerformanceEntry & { element?: Element | null };
            if (e.element) (window as unknown as Record<string, unknown>).__lcpEl = e.element;
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* unsupported */ }

      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value?: number;
              sources?: Array<{ node?: Element; currentRect?: DOMRect }>;
            };
            if (!shift.sources) continue;
            for (const src of shift.sources) {
              const node = src.node;
              if (!node || !(node instanceof Element)) continue;
              const rect = src.currentRect ?? node.getBoundingClientRect();
              const sel  = `${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${node.className ? '.' + String(node.className).trim().split(/\s+/).join('.') : ''}`;
              (window as unknown as { __clsData: unknown[] }).__clsData.push({
                selector: sel,
                shift:    shift.value ?? 0,
                rect:     { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              });
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* unsupported */ }
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }

    await page.waitForTimeout(waitMs);

    // LCP element
    const lcpElement: LcpElement | null = await page.evaluate((vpH) => {
      const el = (window as unknown as { __lcpEl?: Element | null }).__lcpEl;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        tag:         el.tagName.toLowerCase(),
        id:          el.id || null,
        classes:     Array.from(el.classList),
        src:         (el as HTMLImageElement).src ?? null,
        textPreview: el.textContent ? el.textContent.trim().slice(0, 120) : null,
        width:       Math.round(rect.width),
        height:      Math.round(rect.height),
        isAboveFold: rect.top < vpH,
      };
    }, vp.height);

    // Render-blocking resources
    const blockingResources: BlockingResource[] = await page.evaluate(() => {
      const results: BlockingResource[] = [];
      document.querySelectorAll<HTMLScriptElement>('head script[src]').forEach(s => {
        if (!s.async && !s.defer && !s.type?.includes('module')) {
          results.push({ tag: 'script', src: s.src, reason: 'parser-blocking script in <head>' });
        }
      });
      document.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]').forEach(l => {
        if (!l.media || l.media === 'all' || l.media === 'screen') {
          results.push({ tag: 'link', src: l.href, reason: 'render-blocking stylesheet' });
        }
      });
      return results;
    });

    // CLS contributors
    type RawCls = { selector: string; shift: number; rect: { x: number; y: number; width: number; height: number } };
    const clsContributors: ClsContributor[] = await page.evaluate(() => {
      const data = ((window as unknown as { __clsData?: RawCls[] }).__clsData) ?? [];
      const bySelector = new Map<string, ClsContributor>();
      for (const d of data) {
        const ex = bySelector.get(d.selector);
        if (ex) { ex.shift += d.shift; } else { bySelector.set(d.selector, { ...d }); }
      }
      return [...bySelector.values()].sort((a, b) => b.shift - a.shift).slice(0, 10);
    });

    // Third-party scripts
    const thirdPartyScripts: ThirdPartyScript[] = await page.evaluate(() => {
      const origin = location.origin;
      const results: ThirdPartyScript[] = [];
      document.querySelectorAll<HTMLScriptElement>('script[src]').forEach(s => {
        try {
          const u = new URL(s.src);
          if (u.origin !== origin) results.push({ src: s.src, origin: u.origin, async: s.async, defer: s.defer });
        } catch { /* invalid url */ }
      });
      return results;
    });

    return { url, lcpElement, blockingResources, clsContributors, thirdPartyScripts, durationMs: Date.now() - t0 };
  } finally {
    await cdp.detach().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
