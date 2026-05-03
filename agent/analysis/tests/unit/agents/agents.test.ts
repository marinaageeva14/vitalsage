import { describe, it, expect } from 'vitest';
import type { AgentContext, MetricDistribution, PageContext } from '@vitalsage/types';
import { DEFAULT_THRESHOLDS } from '@vitalsage/types';
import { LCPAgent }          from '../../../src/agents/lcp.js';
import { CLSAgent }          from '../../../src/agents/cls.js';
import { INPAgent }          from '../../../src/agents/inp.js';
import { TTFBAgent }         from '../../../src/agents/ttfb.js';
import { RenderBlockAgent }  from '../../../src/agents/render-block.js';
import { ResourceHintAgent } from '../../../src/agents/resource-hint.js';
import { ImageAgent }        from '../../../src/agents/image.js';
import { FontAgent }         from '../../../src/agents/font.js';
import { buildMockSession, buildMockPage, buildMockDevice } from '../../fixtures/builders.js';
import { computeDistributions } from '../../../src/aggregator/distributions.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function poorLCPDist(): MetricDistribution {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    buildMockSession({ metrics: { LCP: { name: 'LCP', value: 5000 + i * 200, rating: 'poor', delta: 0, id: `l${i}`, navigationType: 'navigate', entries: [] } } })
  );
  return computeDistributions(sessions).LCP!;
}

function poorCLSDist(): MetricDistribution {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    buildMockSession({ metrics: { CLS: { name: 'CLS', value: 0.3 + i * 0.01, rating: 'poor', delta: 0, id: `c${i}`, navigationType: 'navigate', entries: [] } } })
  );
  return computeDistributions(sessions).CLS!;
}

function poorINPDist(): MetricDistribution {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    buildMockSession({ metrics: { INP: { name: 'INP', value: 600 + i * 50, rating: 'poor', delta: 0, id: `i${i}`, navigationType: 'navigate', entries: [] } } })
  );
  return computeDistributions(sessions).INP!;
}

function poorTTFBDist(): MetricDistribution {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    buildMockSession({ metrics: { TTFB: { name: 'TTFB', value: 2000 + i * 100, rating: 'poor', delta: 0, id: `t${i}`, navigationType: 'navigate', entries: [] } } })
  );
  return computeDistributions(sessions).TTFB!;
}

function buildCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    buildMockSession({ metrics: { LCP: { name: 'LCP', value: 5000 + i * 200, rating: 'poor', delta: 0, id: `l${i}`, navigationType: 'navigate', entries: [] } } })
  );
  return {
    distributions:      { LCP: poorLCPDist() },
    representativePage: buildMockPage(),
    sessions,
    sampleSize:         10,
    confidence:         'low',
    thresholds:         DEFAULT_THRESHOLDS,
    ...overrides,
  };
}

// ─── BaseAgent ────────────────────────────────────────────────────────────────

describe('BaseAgent.shouldRun()', () => {
  it('returns true when relevant metric is needs-improvement', () => {
    const ctx = buildCtx({ distributions: { LCP: poorLCPDist() } });
    expect(new LCPAgent().shouldRun(ctx)).toBe(true);
  });

  it('returns false when relevant metric is good', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({ metrics: { LCP: { name: 'LCP', value: 500 + i * 10, rating: 'good', delta: 0, id: `g${i}`, navigationType: 'navigate', entries: [] } } })
    );
    const ctx = buildCtx({ distributions: computeDistributions(sessions) });
    expect(new LCPAgent().shouldRun(ctx)).toBe(false);
  });

  it('returns false when metric has no distribution data', () => {
    const ctx = buildCtx({ distributions: {} });
    expect(new LCPAgent().shouldRun(ctx)).toBe(false);
  });
});

// ─── LCPAgent ────────────────────────────────────────────────────────────────

describe('LCPAgent', () => {
  it('skips when no LCP distribution', () => {
    const ctx = buildCtx({ distributions: {} });
    const { skipped } = new LCPAgent().analyze(ctx);
    expect(skipped).toBe(true);
  });

  it('flags missing fetchpriority on LCP image', () => {
    const page: PageContext = { ...buildMockPage(), lcpElement: {
      tagName: 'IMG', src: '/hero.jpg', isThirdParty: false,
      hasExplicitDimensions: true, isPreloaded: true, elementType: 'img',
    }};
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({
        metrics: { LCP: { name: 'LCP', value: 5000 + i * 200, rating: 'poor', delta: 0, id: `l${i}`, navigationType: 'navigate', entries: [] } },
        page: { ...buildMockPage(), lcpElement: { tagName: 'IMG', src: '/hero.jpg', isThirdParty: false, hasExplicitDimensions: true, isPreloaded: true, elementType: 'img' } },
      })
    );
    const ctx = buildCtx({ representativePage: page, sessions, distributions: { LCP: poorLCPDist() } });
    const { suggestions } = new LCPAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('fetchpriority'))).toBe(true);
  });

  it('flags cross-origin LCP without preload', () => {
    const page: PageContext = { ...buildMockPage(), lcpElement: {
      tagName: 'IMG', src: 'https://cdn.example.com/hero.jpg',
      isThirdParty: true, isPreloaded: false,
      hasExplicitDimensions: true, elementType: 'img',
    }};
    const ctx = buildCtx({ representativePage: page });
    const { suggestions } = new LCPAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('cross-origin'))).toBe(true);
  });

  it('flags TTFB masking LCP when both are poor', () => {
    const ctx = buildCtx({ distributions: { LCP: poorLCPDist(), TTFB: poorTTFBDist() } });
    const { suggestions } = new LCPAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('TTFB'))).toBe(true);
  });

  it('suggestion ids are stable (deterministic hash)', () => {
    const page: PageContext = { ...buildMockPage(), lcpElement: {
      tagName: 'IMG', src: '/hero.jpg', isThirdParty: false,
      hasExplicitDimensions: true, isPreloaded: true, elementType: 'img',
    }};
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({
        metrics: { LCP: { name: 'LCP', value: 5000 + i * 200, rating: 'poor', delta: 0, id: `l${i}`, navigationType: 'navigate', entries: [] } },
        page: { ...buildMockPage(), lcpElement: { tagName: 'IMG', src: '/hero.jpg', isThirdParty: false, hasExplicitDimensions: true, isPreloaded: true, elementType: 'img' } },
      })
    );
    const ctx = buildCtx({ representativePage: page, sessions, distributions: { LCP: poorLCPDist() } });
    const r1 = new LCPAgent().analyze(ctx);
    const r2 = new LCPAgent().analyze(ctx);
    expect(r1.suggestions.map(s => s.id)).toEqual(r2.suggestions.map(s => s.id));
  });
});

// ─── CLSAgent ────────────────────────────────────────────────────────────────

describe('CLSAgent', () => {
  it('skips when no CLS distribution', () => {
    expect(new CLSAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags unsized above-fold images in >30% of sessions', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({
        metrics: { CLS: { name: 'CLS', value: 0.3 + i * 0.01, rating: 'poor', delta: 0, id: `c${i}`, navigationType: 'navigate', entries: [] } },
        page: { ...buildMockPage(), images: [{ src: '/img.jpg', isLCP: false, isAboveFold: true, hasExplicitDimensions: false, isResponsive: false, isFromCache: false }] },
      })
    );
    const ctx = buildCtx({ distributions: { CLS: poorCLSDist() }, sessions });
    const { suggestions } = new CLSAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('dimensions'))).toBe(true);
  });

  it('flags very high CLS (poor rating)', () => {
    const ctx = buildCtx({ distributions: { CLS: poorCLSDist() } });
    const { suggestions } = new CLSAgent().analyze(ctx);
    expect(suggestions.some(s => s.metric === 'CLS')).toBe(true);
  });
});

// ─── INPAgent ────────────────────────────────────────────────────────────────

describe('INPAgent', () => {
  it('skips when no INP distribution', () => {
    expect(new INPAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags synchronous third-party scripts in head', () => {
    const page: PageContext = { ...buildMockPage(), scripts: [{
      isInline: false, isDeferred: false, isAsync: false, isModule: false,
      isRenderBlocking: false, position: 'head', isThirdParty: true,
      src: 'https://analytics.example.com/track.js',
    }]};
    const ctx = buildCtx({ distributions: { INP: poorINPDist() }, representativePage: page });
    const { suggestions } = new INPAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('third-party'))).toBe(true);
  });

  it('flags very poor INP (>500ms)', () => {
    const ctx = buildCtx({ distributions: { INP: poorINPDist() } });
    const { suggestions } = new INPAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('poor'))).toBe(true);
  });
});

// ─── TTFBAgent ───────────────────────────────────────────────────────────────

describe('TTFBAgent', () => {
  it('skips when no TTFB distribution', () => {
    expect(new TTFBAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags high server response time', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({
        metrics: { TTFB: { name: 'TTFB', value: 2000 + i * 100, rating: 'poor', delta: 0, id: `t${i}`, navigationType: 'navigate', entries: [] } },
        page: { ...buildMockPage(), navigationTiming: { redirectTime: 0, dnsTime: 10, tlsTime: 30, serverTime: 800, downloadTime: 50, domParseTime: 100, totalLoadTime: 1000, workerTime: 0, isServiceWorker: false, redirectCount: 0 } },
      })
    );
    const ctx = buildCtx({ distributions: { TTFB: poorTTFBDist() }, sessions });
    const { suggestions } = new TTFBAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('Server response'))).toBe(true);
  });
});

// ─── RenderBlockAgent ────────────────────────────────────────────────────────

describe('RenderBlockAgent', () => {
  it('skips when no FCP or LCP data', () => {
    expect(new RenderBlockAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags render-blocking scripts', () => {
    const page: PageContext = { ...buildMockPage(), scripts: [{
      isInline: false, isDeferred: false, isAsync: false, isModule: false,
      isRenderBlocking: true, position: 'head', isThirdParty: false,
    }]};
    const ctx = buildCtx({ representativePage: page, distributions: { FCP: computeDistributions(
      Array.from({ length: 10 }, (_, i) => buildMockSession({ metrics: { FCP: { name: 'FCP', value: 4000 + i * 100, rating: 'poor', delta: 0, id: `f${i}`, navigationType: 'navigate', entries: [] } } }))
    ).FCP! }});
    const { suggestions } = new RenderBlockAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('render-blocking'))).toBe(true);
  });
});

// ─── ResourceHintAgent ───────────────────────────────────────────────────────

describe('ResourceHintAgent', () => {
  it('skips when no LCP data', () => {
    expect(new ResourceHintAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags unpreloaded LCP image', () => {
    const page: PageContext = { ...buildMockPage(), lcpElement: {
      tagName: 'IMG', src: '/hero.jpg', isThirdParty: false,
      hasExplicitDimensions: true, isPreloaded: false, elementType: 'img',
    }};
    const ctx = buildCtx({ representativePage: page });
    const { suggestions } = new ResourceHintAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('not preloaded'))).toBe(true);
  });
});

// ─── ImageAgent ──────────────────────────────────────────────────────────────

describe('ImageAgent', () => {
  it('skips when no LCP or FCP data', () => {
    expect(new ImageAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags above-fold images with loading=lazy', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({
        metrics: { LCP: { name: 'LCP', value: 5000 + i * 200, rating: 'poor', delta: 0, id: `l${i}`, navigationType: 'navigate', entries: [] } },
        page: { ...buildMockPage(), images: [{ src: '/hero.jpg', isLCP: true, isAboveFold: true, hasExplicitDimensions: true, loading: 'lazy', isResponsive: true, isFromCache: false }] },
      })
    );
    const ctx = buildCtx({ sessions });
    const { suggestions } = new ImageAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('lazy'))).toBe(true);
  });

  it('flags oversized LCP image', () => {
    const page: PageContext = { ...buildMockPage(), lcpElement: {
      tagName: 'IMG', src: '/hero.jpg', isThirdParty: false,
      hasExplicitDimensions: true, isPreloaded: true, elementType: 'img',
      naturalWidth: 3000, displayWidth: 600,
    }};
    const ctx = buildCtx({ representativePage: page });
    const { suggestions } = new ImageAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('oversized'))).toBe(true);
  });
});

// ─── FontAgent ───────────────────────────────────────────────────────────────

describe('FontAgent', () => {
  it('skips when no FCP or CLS data', () => {
    expect(new FontAgent().analyze(buildCtx({ distributions: {} })).skipped).toBe(true);
  });

  it('flags preloaded font missing crossorigin', () => {
    const page: PageContext = { ...buildMockPage(), fonts: [{
      family: 'MyFont', display: 'swap', url: '/font.woff2',
      isPreloaded: true, hasCrossOrigin: false,
      isSystemFont: false, isIconFont: false,
    }]};
    const fcp = computeDistributions(
      Array.from({ length: 10 }, (_, i) => buildMockSession({ metrics: { FCP: { name: 'FCP', value: 3000 + i * 100, rating: 'needs-improvement', delta: 0, id: `f${i}`, navigationType: 'navigate', entries: [] } } }))
    ).FCP!;
    const ctx = buildCtx({ representativePage: page, distributions: { FCP: fcp } });
    const { suggestions } = new FontAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('crossorigin'))).toBe(true);
  });

  it('flags unpreloaded web fonts', () => {
    const page: PageContext = { ...buildMockPage(), fonts: [{
      family: 'MyFont', display: 'swap', url: '/font.woff2',
      isPreloaded: false, hasCrossOrigin: false,
      isSystemFont: false, isIconFont: false,
    }]};
    const fcp = computeDistributions(
      Array.from({ length: 10 }, (_, i) => buildMockSession({ metrics: { FCP: { name: 'FCP', value: 3000 + i * 100, rating: 'needs-improvement', delta: 0, id: `f${i}`, navigationType: 'navigate', entries: [] } } }))
    ).FCP!;
    const ctx = buildCtx({ representativePage: page, distributions: { FCP: fcp } });
    const { suggestions } = new FontAgent().analyze(ctx);
    expect(suggestions.some(s => s.title.includes('not preloaded'))).toBe(true);
  });
});
