import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextCollector } from '../../../src/collector/context.js';
import type { SerializablePerformanceEntry } from '@vitalsage/types';

// stub collectNavigationTiming — unit-tested separately
vi.mock('../../../src/collector/navigation-timing.js', () => ({
  collectNavigationTiming: () => ({
    redirectTime: 0, dnsTime: 10, tlsTime: 15, serverTime: 50,
    downloadTime: 40, domParseTime: 80, totalLoadTime: 300,
    workerTime: 0, isServiceWorker: false, redirectCount: 0,
  }),
}));

function makeLCPEntry(overrides: Partial<SerializablePerformanceEntry> = {}): SerializablePerformanceEntry {
  return {
    entryType: 'largest-contentful-paint',
    name: '',
    startTime: 1500,
    duration: 0,
    element: 'IMG',
    url: 'https://example.com/hero.jpg',
    loadTime: 1200,
    renderTime: 1500,
    ...overrides,
  };
}

describe('ContextCollector.collect', () => {
  let collector: ContextCollector;

  beforeEach(() => {
    collector = new ContextCollector();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects basic page fields', () => {
    const ctx = collector.collect();
    expect(typeof ctx.url).toBe('string');
    expect(typeof ctx.title).toBe('string');
    expect(typeof ctx.domNodeCount).toBe('number');
    expect(ctx.domNodeCount).toBeGreaterThan(0);
    expect(Array.isArray(ctx.resources)).toBe(true);
    expect(Array.isArray(ctx.fonts)).toBe(true);
    expect(Array.isArray(ctx.images)).toBe(true);
    expect(Array.isArray(ctx.scripts)).toBe(true);
    expect(Array.isArray(ctx.stylesheets)).toBe(true);
  });

  it('passes navigationTiming from collectNavigationTiming', () => {
    const ctx = collector.collect();
    expect(ctx.navigationTiming.dnsTime).toBe(10);
    expect(ctx.navigationTiming.serverTime).toBe(50);
  });

  it('omits lcpElement when no LCP entries passed', () => {
    const ctx = collector.collect([]);
    expect('lcpElement' in ctx).toBe(false);
  });

  it('omits lcpElement when LCP entry has no element', () => {
    const entry = makeLCPEntry({ element: undefined });
    const ctx = collector.collect([entry]);
    expect('lcpElement' in ctx).toBe(false);
  });

  it('builds lcpElement from LCP entries', () => {
    const ctx = collector.collect([makeLCPEntry()]);
    expect(ctx.lcpElement).toBeDefined();
    expect(ctx.lcpElement?.tagName).toBe('IMG');
    expect(ctx.lcpElement?.src).toBe('https://example.com/hero.jpg');
    expect(ctx.lcpElement?.elementType).toBe('img');
  });

  it('marks third-party LCP element correctly', () => {
    const ctx = collector.collect([makeLCPEntry({ url: 'https://cdn.third-party.com/img.jpg' })]);
    expect(ctx.lcpElement?.isThirdParty).toBe(true);
  });

  it('marks first-party LCP element correctly', () => {
    // Use the actual jsdom origin so the same-origin check passes
    const sameOriginUrl = `${location.origin}/img.jpg`;
    const ctx = collector.collect([makeLCPEntry({ url: sameOriginUrl })]);
    expect(ctx.lcpElement?.isThirdParty).toBe(false);
  });

  it('caps resources at 250', () => {
    const manyEntries = Array.from({ length: 300 }, (_, i) => ({
      name:                 `https://example.com/resource-${i}.js`,
      initiatorType:        'script',
      duration:             10,
      transferSize:         1000,
      encodedBodySize:      1000,
      decodedBodySize:      1000,
      fetchStart:           0,
      responseEnd:          10,
      renderBlockingStatus: undefined,
      toJSON:               () => ({}),
    }));
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue(
      manyEntries as unknown as PerformanceEntry[],
    );
    expect(collector.collect().resources).toHaveLength(250);
  });

  it('marks cached resources (transferSize=0, decodedBodySize>0)', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{
      name: 'https://example.com/app.js', initiatorType: 'script',
      duration: 1, transferSize: 0, encodedBodySize: 0, decodedBodySize: 5000,
      fetchStart: 0, responseEnd: 1, toJSON: () => ({}),
    }] as unknown as PerformanceEntry[]);
    const [res] = collector.collect().resources;
    expect(res?.fromCache).toBe(true);
  });
});

describe('ContextCollector — scripts collection', () => {
  let collector: ContextCollector;

  beforeEach(() => {
    collector = new ContextCollector();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up injected scripts
    document.querySelectorAll('script[data-test]').forEach(el => el.remove());
  });

  it('detects inline script', () => {
    const s = document.createElement('script');
    s.dataset['test'] = '1';
    s.textContent = 'console.log("hello")';
    document.head.appendChild(s);

    const scripts = collector.collect().scripts;
    const inline = scripts.find(sc => sc.isInline && sc.position === 'head');
    expect(inline).toBeDefined();
    expect(inline?.isRenderBlocking).toBe(false); // inline scripts are not render-blocking
  });

  it('detects render-blocking external script in head', () => {
    const s = document.createElement('script');
    s.dataset['test'] = '1';
    s.src = 'http://localhost/app.js';
    // no defer, no async
    document.head.appendChild(s);

    const scripts = collector.collect().scripts;
    const blocking = scripts.find(sc => sc.src === 'http://localhost/app.js');
    expect(blocking?.isRenderBlocking).toBe(true);
    expect(blocking?.position).toBe('head');
  });

  it('detects async script as non-blocking', () => {
    const s = document.createElement('script');
    s.dataset['test'] = '1';
    s.src = 'http://localhost/async.js';
    s.async = true;
    document.head.appendChild(s);

    const blocking = collector.collect().scripts.find(sc => sc.src === 'http://localhost/async.js');
    expect(blocking?.isRenderBlocking).toBe(false);
  });

  it('detects deferred script as non-blocking', () => {
    const s = document.createElement('script');
    s.dataset['test'] = '1';
    s.src = 'http://localhost/deferred.js';
    s.defer = true;
    document.head.appendChild(s);

    const blocking = collector.collect().scripts.find(sc => sc.src === 'http://localhost/deferred.js');
    expect(blocking?.isRenderBlocking).toBe(false);
  });

  it('classifies third-party script', () => {
    const s = document.createElement('script');
    s.dataset['test'] = '1';
    s.src = 'https://cdn.third-party.com/lib.js';
    document.body.appendChild(s);

    const entry = collector.collect().scripts.find(sc => sc.src?.includes('third-party'));
    expect(entry?.isThirdParty).toBe(true);
    expect(entry?.position).toBe('body');
  });
});

describe('ContextCollector — images collection', () => {
  let collector: ContextCollector;

  beforeEach(() => {
    collector = new ContextCollector();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('img[data-test]').forEach(el => el.remove());
  });

  it('collects img elements', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'http://localhost/test.png';
    document.body.appendChild(img);

    const images = collector.collect().images;
    const found = images.find(i => i.src.includes('test.png'));
    expect(found).toBeDefined();
    expect(found?.isResponsive).toBe(false);
  });

  it('detects explicit dimensions', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.setAttribute('width', '300');
    img.setAttribute('height', '200');
    img.src = 'http://localhost/sized.png';
    document.body.appendChild(img);

    const found = collector.collect().images.find(i => i.src.includes('sized'));
    expect(found?.hasExplicitDimensions).toBe(true);
  });

  it('detects srcset as responsive', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'http://localhost/resp.png';
    img.setAttribute('srcset', 'http://localhost/resp@2x.png 2x');
    document.body.appendChild(img);

    const found = collector.collect().images.find(i => i.src.includes('resp.png'));
    expect(found?.isResponsive).toBe(true);
  });

  it('infers format from URL extension', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'http://localhost/photo.webp';
    document.body.appendChild(img);

    const found = collector.collect().images.find(i => i.src.includes('photo.webp'));
    expect(found?.format).toBe('webp');
  });
});

describe('ContextCollector — stylesheets', () => {
  let collector: ContextCollector;

  beforeEach(() => {
    collector = new ContextCollector();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('link[data-test]').forEach(el => el.remove());
  });

  it('detects render-blocking stylesheet (no media)', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost/styles.css';
    link.dataset['test'] = '1';
    document.head.appendChild(link);

    const ss = collector.collect().stylesheets.find(s => s.href?.includes('styles.css'));
    expect(ss?.isRenderBlocking).toBe(true);
  });

  it('detects non-blocking print stylesheet', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost/print.css';
    link.media = 'print';
    link.dataset['test'] = '1';
    document.head.appendChild(link);

    const ss = collector.collect().stylesheets.find(s => s.href?.includes('print.css'));
    expect(ss?.isRenderBlocking).toBe(false);
  });

  it('handles stylesheet link without href (isThirdParty = false)', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    // deliberately no href
    link.dataset['test'] = '1';
    document.head.appendChild(link);

    const ss = collector.collect().stylesheets.find(s => !s.href);
    expect(ss?.isThirdParty).toBe(false);
  });
});

// Helper: create a fake CSSStyleSheet with font-face rule objects
function makeFontSheet(rules: Array<{ family: string; display?: string; src: string }>) {
  const cssRules = rules.map(r => ({
    type: CSSRule.FONT_FACE_RULE,
    style: {
      getPropertyValue: (prop: string) => {
        if (prop === 'font-family') return `"${r.family}"`;
        if (prop === 'font-display') return r.display ?? '';
        if (prop === 'src') return r.src;
        return '';
      },
    },
  }));
  return { cssRules };
}

function stubStyleSheets(sheets: Array<{ cssRules: unknown[] } | 'error'>) {
  Object.defineProperty(document, 'styleSheets', {
    get: () => sheets.map(sheet =>
      sheet === 'error'
        ? new Proxy({}, { get() { throw new DOMException('SecurityError'); } })
        : sheet
    ),
    configurable: true,
  });
}

function restoreStyleSheets() {
  Object.defineProperty(document, 'styleSheets', {
    get: () => Object.getOwnPropertyDescriptor(Document.prototype, 'styleSheets')?.get?.call(document),
    configurable: true,
  });
}

describe('ContextCollector — fonts', () => {
  let collector: ContextCollector;

  beforeEach(() => {
    collector = new ContextCollector();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreStyleSheets();
    document.querySelectorAll('link[data-test]').forEach(el => el.remove());
  });

  it('collects @font-face rules from stylesheets', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'MyFont',
      display: 'swap',
      src: 'url("/fonts/my.woff2") format("woff2")',
    }])]);

    const font = collector.collect().fonts.find(f => f.family === 'MyFont');
    expect(font).toBeDefined();
    expect(font?.display).toBe('swap');
    // Relative CSS urls are resolved to absolute so preload-link comparison works
    expect(font?.url).toBe(new URL('/fonts/my.woff2', location.href).href);
    expect(font?.format).toBe('woff2');
    expect(font?.isSystemFont).toBe(false);
    expect(font?.isIconFont).toBe(false);
  });

  it('marks icon font correctly', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'Font Awesome 6',
      src: 'url("/fa.woff2") format("woff2")',
    }])]);

    const font = collector.collect().fonts.find(f => f.family.includes('Font Awesome'));
    expect(font?.isIconFont).toBe(true);
  });

  it('marks font as preloaded when matching preload link exists', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'Preloaded',
      src: 'url("http://localhost/preloaded.woff2") format("woff2")',
    }])]);

    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.setAttribute('as', 'font');
    preload.href = 'http://localhost/preloaded.woff2';
    preload.dataset['test'] = '1';
    document.head.appendChild(preload);

    const font = collector.collect().fonts.find(f => f.family === 'Preloaded');
    expect(font?.isPreloaded).toBe(true);
  });

  it('marks cross-origin font via isCrossOrigin', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'RemoteFont',
      src: 'url("https://fonts.gstatic.com/remote.woff2") format("woff2")',
    }])]);

    const font = collector.collect().fonts.find(f => f.family === 'RemoteFont');
    // isCrossOrigin = URL origin differs from the page
    expect(font?.isCrossOrigin).toBe(true);
    // hasCrossOrigin = the preload link carries the crossorigin attribute;
    // no preload exists here, so it must be false
    expect(font?.hasCrossOrigin).toBe(false);
  });

  it('detects crossorigin attribute on the matching preload link', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'CorsFont',
      src: 'url("http://localhost/cors.woff2") format("woff2")',
    }])]);

    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.setAttribute('as', 'font');
    preload.setAttribute('crossorigin', '');
    preload.href = 'http://localhost/cors.woff2';
    preload.dataset['test'] = '1';
    document.head.appendChild(preload);

    const font = collector.collect().fonts.find(f => f.family === 'CorsFont');
    expect(font?.isPreloaded).toBe(true);
    expect(font?.hasCrossOrigin).toBe(true);
  });

  it('handles font without format or display gracefully', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'Plain',
      src: 'url("/plain.woff")',
    }])]);

    const font = collector.collect().fonts.find(f => f.family === 'Plain');
    expect(font).toBeDefined();
    expect(font?.display).toBe('auto');
    expect('format' in (font ?? {})).toBe(false);
  });

  it('skips cross-origin stylesheets that throw SecurityError', () => {
    stubStyleSheets(['error']);
    // Should not throw and should return empty font list
    expect(() => collector.collect().fonts).not.toThrow();
  });

  it('skips non-font-face rules in stylesheet', () => {
    stubStyleSheets([{
      cssRules: [
        { type: CSSRule.STYLE_RULE, style: { getPropertyValue: () => '' } },
      ],
    }]);
    expect(collector.collect().fonts).toHaveLength(0);
  });

  it('handles font-face with no url() in src (local() font)', () => {
    stubStyleSheets([makeFontSheet([{
      family: 'LocalFont',
      src: 'local("Arial")',
    }])]);

    const font = collector.collect().fonts.find(f => f.family === 'LocalFont');
    expect(font).toBeDefined();
    expect('url' in (font ?? {})).toBe(false);
    // url is absent → hasCrossOrigin should be false
    expect(font?.hasCrossOrigin).toBe(false);
    expect(font?.isPreloaded).toBe(false);
  });
});

describe('ContextCollector — images with attributes', () => {
  let collector: ContextCollector;

  beforeEach(() => {
    collector = new ContextCollector();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('img[data-test]').forEach(el => el.remove());
  });

  it('captures loading and fetchpriority attributes', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'http://localhost/lazy.jpg';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('fetchpriority', 'low');
    document.body.appendChild(img);

    const found = collector.collect().images.find(i => i.src.includes('lazy.jpg'));
    expect(found?.loading).toBe('lazy');
    expect(found?.fetchPriority).toBe('low');
  });

  it('returns undefined format for data: URIs', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'data:image/png;base64,abc';
    document.body.appendChild(img);

    const found = collector.collect().images.find(i => i.src.startsWith('data:'));
    expect('format' in (found ?? {})).toBe(false);
  });

  it('marks cached image from resource timing', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'http://localhost/cached.png';
    document.body.appendChild(img);

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{
      name: 'http://localhost/cached.png',
      transferSize: 0, decodedBodySize: 2000,
      toJSON: () => ({}),
    }] as unknown as PerformanceEntry[]);

    const found = collector.collect().images.find(i => i.src.includes('cached.png'));
    expect(found?.isFromCache).toBe(true);
  });

  it('detects LCP image by matching src pathname', () => {
    const img = document.createElement('img');
    img.dataset['test'] = '1';
    img.src = 'http://localhost/hero.jpg';
    document.body.appendChild(img);

    const lcpEntry = makeLCPEntry({ url: 'http://localhost/hero.jpg' });
    const found = collector.collect([lcpEntry]).images.find(i => i.src.includes('hero.jpg'));
    expect(found?.isLCP).toBe(true);
  });
});
