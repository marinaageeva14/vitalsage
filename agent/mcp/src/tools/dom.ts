/**
 * find_element_in_dom tool
 *
 * Navigates to a URL with Playwright and extracts DOM-level performance
 * intelligence that synthetic metrics alone can't surface:
 *
 *   • LCP element  — tag, src/text preview, size, CSS classes
 *   • Render-blocking resources — scripts/stylesheets in <head> with no
 *     async/defer/media tricks
 *   • CLS contributors — layout-shifted elements with shift value + rect
 *   • Image lazy-load opportunities — above-fold images missing loading="lazy"
 *   • Third-party scripts — scripts from origins != the page origin
 *
 * Claude uses this to pinpoint exactly which element/resource to fix.
 */
import { z }        from 'zod';
import { chromium } from 'playwright';

export const DomInputSchema = z.object({
  url: z.string().url().describe('Page URL to inspect'),
  waitMs: z.number().int().min(500).max(15000).default(5000)
    .describe('How long to wait after load before snapshotting (ms). Default 5000.'),
  network: z.enum(['wifi', '4g', '3g']).default('4g')
    .describe('Network throttle profile. Default "4g".'),
  viewport: z.enum(['desktop', 'mobile']).default('desktop')
    .describe('Viewport size. Default "desktop".'),
});

export type DomInput = z.infer<typeof DomInputSchema>;

export interface LcpElement {
  tag:      string;
  id:       string | null;
  classes:  string[];
  src:      string | null;
  textPreview: string | null;
  width:    number;
  height:   number;
  isAboveFold: boolean;
}

export interface BlockingResource {
  tag:    'script' | 'link';
  src:    string;
  reason: string;
}

export interface ClsContributor {
  selector:   string;
  shift:      number;
  rect:       { x: number; y: number; width: number; height: number };
}

export interface ImageOpportunity {
  src:    string;
  width:  number;
  height: number;
  bytes:  number | null;
}

export interface ThirdPartyScript {
  src:    string;
  origin: string;
  async:  boolean;
  defer:  boolean;
}

export interface DomFindings {
  url:                 string;
  lcpElement:          LcpElement | null;
  blockingResources:   BlockingResource[];
  clsContributors:     ClsContributor[];
  imageLazyOpportunities: ImageOpportunity[];
  thirdPartyScripts:   ThirdPartyScript[];
  durationMs:          number;
}

const NETWORK_PROFILES = {
  wifi:   { offline: false, downloadThroughput: 30 * 1024 * 1024 / 8, uploadThroughput: 15 * 1024 * 1024 / 8, latency: 2    },
  '4g':   { offline: false, downloadThroughput:  4 * 1024 * 1024 / 8, uploadThroughput:  3 * 1024 * 1024 / 8, latency: 20   },
  '3g':   { offline: false, downloadThroughput:  1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8,     latency: 100  },
};

const VIEWPORT_SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile:  { width: 390,  height: 844 },
};

export async function findElementInDom(input: DomInput): Promise<DomFindings> {
  const t0 = Date.now();
  const vp = VIEWPORT_SIZES[input.viewport];

  const browser  = await chromium.launch({ headless: true });
  const context  = await browser.newContext({ viewport: vp, isMobile: input.viewport === 'mobile' });
  const page     = await context.newPage();
  const cdp      = await context.newCDPSession(page);

  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', NETWORK_PROFILES[input.network]);

    // Inject PerformanceObserver for LCP and CLS before navigation
    await page.addInitScript(() => {
      (window as unknown as { __lcpEl?: Element | null; __clsData?: Array<{ selector: string; shift: number; rect: DOMRect }> }).__lcpEl = null;
      (window as unknown as { __clsData?: Array<{ selector: string; shift: number; rect: DOMRect }> }).__clsData = [];

      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const e = entry as PerformanceEntry & { element?: Element | null };
            if (e.element) {
              (window as unknown as { __lcpEl?: Element | null }).__lcpEl = e.element;
            }
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* browser may not support */ }

      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value?: number; sources?: Array<{ node?: Element; previousRect?: DOMRect; currentRect?: DOMRect }> };
            if (!shift.sources) continue;
            for (const src of shift.sources) {
              const node = src.node;
              if (!node) continue;
              const rect = src.currentRect ?? (node as Element).getBoundingClientRect?.();
              const sel  = node instanceof Element
                ? `${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${node.className ? '.' + String(node.className).trim().split(/\s+/).join('.') : ''}`
                : 'unknown';
              (window as unknown as { __clsData: Array<{ selector: string; shift: number; rect: DOMRect }> }).__clsData.push({
                selector: sel,
                shift:    shift.value ?? 0,
                rect:     rect as DOMRect,
              });
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* browser may not support */ }
    });

    try {
      await page.goto(input.url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch {
      await page.goto(input.url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }

    await page.waitForTimeout(input.waitMs);

    // ── LCP element ──────────────────────────────────────────────────────────
    const lcpElement: LcpElement | null = await page.evaluate((viewportH) => {
      const el = (window as unknown as { __lcpEl?: Element | null }).__lcpEl;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        tag:         el.tagName.toLowerCase(),
        id:          el.id || null,
        classes:     Array.from(el.classList),
        src:         (el as HTMLImageElement).src ?? (el as HTMLElement).style?.backgroundImage ?? null,
        textPreview: el.textContent ? el.textContent.trim().slice(0, 120) : null,
        width:       Math.round(rect.width),
        height:      Math.round(rect.height),
        isAboveFold: rect.top < viewportH,
      };
    }, vp.height);

    // ── Render-blocking resources ────────────────────────────────────────────
    const blockingResources: BlockingResource[] = await page.evaluate(() => {
      const results: Array<{ tag: 'script' | 'link'; src: string; reason: string }> = [];
      // Scripts in <head> without async/defer
      document.querySelectorAll<HTMLScriptElement>('head script[src]').forEach(s => {
        if (!s.async && !s.defer && !s.type?.includes('module')) {
          results.push({ tag: 'script', src: s.src, reason: 'parser-blocking script in <head>' });
        }
      });
      // Stylesheets without media query optimisation
      document.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]').forEach(l => {
        if (!l.media || l.media === 'all' || l.media === 'screen') {
          results.push({ tag: 'link', src: l.href, reason: 'render-blocking stylesheet' });
        }
      });
      return results;
    });

    // ── CLS contributors ────────────────────────────────────────────────────
    const clsContributors: ClsContributor[] = await page.evaluate(() => {
      const data = (window as unknown as { __clsData?: Array<{ selector: string; shift: number; rect: DOMRect }> }).__clsData ?? [];
      // Aggregate by selector, sum shifts
      const bySelector = new Map<string, ClsContributor>();
      for (const d of data) {
        const existing = bySelector.get(d.selector);
        if (existing) {
          existing.shift += d.shift;
        } else {
          bySelector.set(d.selector, {
            selector: d.selector,
            shift:    d.shift,
            rect:     { x: d.rect.x, y: d.rect.y, width: d.rect.width, height: d.rect.height },
          });
        }
      }
      return [...bySelector.values()].sort((a, b) => b.shift - a.shift).slice(0, 10);
    });

    // ── Image lazy-load opportunities ────────────────────────────────────────
    const imageLazyOpportunities: ImageOpportunity[] = await page.evaluate((viewportH) => {
      const results: Array<{ src: string; width: number; height: number; bytes: number | null }> = [];
      document.querySelectorAll<HTMLImageElement>('img').forEach(img => {
        const rect = img.getBoundingClientRect();
        // Below-fold images missing loading="lazy"
        if (rect.top > viewportH && img.loading !== 'lazy' && img.src) {
          results.push({
            src:    img.src,
            width:  img.naturalWidth  || Math.round(rect.width),
            height: img.naturalHeight || Math.round(rect.height),
            bytes:  null,
          });
        }
      });
      return results.slice(0, 20);
    }, vp.height);

    // ── Third-party scripts ──────────────────────────────────────────────────
    const thirdPartyScripts: ThirdPartyScript[] = await page.evaluate(() => {
      const origin = location.origin;
      const results: ThirdPartyScript[] = [];
      document.querySelectorAll<HTMLScriptElement>('script[src]').forEach(s => {
        try {
          const u = new URL(s.src);
          if (u.origin !== origin) {
            results.push({ src: s.src, origin: u.origin, async: s.async, defer: s.defer });
          }
        } catch { /* ignore invalid urls */ }
      });
      return results;
    });

    return {
      url:                    input.url,
      lcpElement,
      blockingResources,
      clsContributors,
      imageLazyOpportunities,
      thirdPartyScripts,
      durationMs:             Date.now() - t0,
    };
  } finally {
    await cdp.detach().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
