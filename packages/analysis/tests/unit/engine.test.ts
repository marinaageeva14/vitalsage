import { describe, it, expect } from 'vitest';
import { AnalysisEngine }     from '../../src/engine.js';
import { buildMockSession }   from '../fixtures/builders.js';
import type { SessionReport } from '@vitalsage/types';

function buildSessions(count: number, overrides: Partial<SessionReport> = {}): SessionReport[] {
  return Array.from({ length: count }, () => buildMockSession({
    metrics: {
      LCP: { name: 'LCP', value: 3200, rating: 'needs-improvement', delta: 3200, id: 'lcp-1', navigationType: 'navigate', entries: [] },
      FCP: { name: 'FCP', value: 2000, rating: 'needs-improvement', delta: 2000, id: 'fcp-1', navigationType: 'navigate', entries: [] },
    },
    ...overrides,
  }));
}

describe('AnalysisEngine', () => {
  it('returns [] for empty sessions', async () => {
    const engine  = new AnalysisEngine();
    const reports = await engine.analyze([]);
    expect(reports).toEqual([]);
  });

  it('returns insufficient report when below minSamples', async () => {
    const engine  = new AnalysisEngine();
    const sessions = buildSessions(10);
    const reports  = await engine.analyze(sessions);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.confidence).toBe('insufficient');
    expect(reports[0]!.suggestions[0]!.title).toMatch(/insufficient/i);
  });

  it('returns a valid AnalysisReport for sufficient sessions', async () => {
    const engine  = new AnalysisEngine();
    const sessions = buildSessions(60);
    const reports  = await engine.analyze(sessions);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.analysisId).toBeTruthy();
    expect(report.generatedAt).toBeGreaterThan(0);
    expect(report.sampleSize).toBe(60);
    // 60 < CONFIDENCE_THRESHOLDS.low (100) so confidence is 'insufficient' from computeConfidence
    // but the report is still produced (minSamples=50 gate passed)
    expect(report.confidence).toMatch(/low|medium|high|insufficient/);
    expect(typeof report.distributions).toBe('object');
    expect(Array.isArray(report.suggestions)).toBe(true);
  });

  it('generates suggestions for sessions with render-blocking scripts', async () => {
    const engine  = new AnalysisEngine();
    const sessions = Array.from({ length: 60 }, () => buildMockSession({
      metrics: {
        FCP: { name: 'FCP', value: 3500, rating: 'poor', delta: 3500, id: 'fcp-p', navigationType: 'navigate', entries: [] },
      },
      page: {
        url: 'https://example.com/',
        referrer: '',
        title: 'Test',
        domNodeCount: 100,
        resources: [],
        fonts: [],
        images: [],
        scripts: [{
          isRenderBlocking: true,
          isInline: false,
          isDeferred: false,
          isAsync: false,
          isModule: false,
          position: 'head',
          isThirdParty: false,
        }],
        stylesheets: [],
        navigationTiming: { redirectTime: 0, dnsTime: 10, tlsTime: 30, serverTime: 200, downloadTime: 50, domParseTime: 100, totalLoadTime: 500, workerTime: 0, isServiceWorker: false, redirectCount: 0 },
      },
    }));
    const reports = await engine.analyze(sessions);
    expect(reports[0]!.suggestions.length).toBeGreaterThan(0);
    expect(reports[0]!.suggestions.some(s => s.agent === 'render-block')).toBe(true);
  });

  it('respects timeWindow filter', async () => {
    const engine  = new AnalysisEngine();
    const now     = Date.now();
    const old     = buildSessions(60).map(s => ({ ...s, timestamp: now - 10_000_000 }));
    const recent  = buildSessions(60).map(s => ({ ...s, timestamp: now }));
    const all     = [...old, ...recent];

    const reports = await engine.analyze(all, {
      timeWindow: { from: now - 1000, to: now + 1000 },
    });
    expect(reports[0]!.sampleSize).toBe(60);
  });

  it('respects includeRealOnly filter', async () => {
    const engine   = new AnalysisEngine();
    const real      = buildSessions(60, { synthetic: false });
    const synthetic = buildSessions(40, { synthetic: true });
    const reports   = await engine.analyze([...real, ...synthetic], { includeRealOnly: true });
    expect(reports[0]!.sampleSize).toBe(60);
    expect(reports[0]!.syntheticCount).toBe(0);
  });

  it('respects includeSyntheticOnly filter', async () => {
    const engine    = new AnalysisEngine();
    const real       = buildSessions(40, { synthetic: false });
    const synthetic  = buildSessions(60, { synthetic: true });
    const reports    = await engine.analyze([...real, ...synthetic], { includeSyntheticOnly: true });
    expect(reports[0]!.sampleSize).toBe(60);
    expect(reports[0]!.realCount).toBe(0);
    expect(reports[0]!.syntheticCount).toBe(60);
  });

  it('groups sessions by route', async () => {
    const engine    = new AnalysisEngine();
    const homeSessions  = buildSessions(60).map(s => ({ ...s, route: { ...s.route, pattern: '/' } }));
    const aboutSessions = buildSessions(60).map(s => ({ ...s, route: { ...s.route, pattern: '/about' } }));
    const reports = await engine.analyze([...homeSessions, ...aboutSessions]);
    expect(reports).toHaveLength(2);
    const patterns = reports.map(r => r.route.pattern).sort();
    expect(patterns).toEqual(['/', '/about']);
  });

  it('sorts reports by sampleSize descending', async () => {
    const engine     = new AnalysisEngine();
    const big    = buildSessions(80).map(s => ({ ...s, route: { ...s.route, pattern: '/big' } }));
    const small  = buildSessions(55).map(s => ({ ...s, route: { ...s.route, pattern: '/small' } }));
    const reports = await engine.analyze([...big, ...small]);
    expect(reports[0]!.sampleSize).toBeGreaterThanOrEqual(reports[1]!.sampleSize);
  });

  it('respects custom minSamples option — analyzes when count >= minSamples', async () => {
    const engine  = new AnalysisEngine();
    const sessions = buildSessions(30);
    const reports  = await engine.analyze(sessions, { minSamples: 25 });
    // 30 >= 25 → analysis runs; report exists with distributions (not the bare "insufficient data" stub)
    expect(reports).toHaveLength(1);
    expect(Object.keys(reports[0]!.distributions).length).toBeGreaterThan(0);
  });

  it('sets analysisVersion', async () => {
    const engine  = new AnalysisEngine();
    const sessions = buildSessions(60);
    const reports  = await engine.analyze(sessions);
    expect(reports[0]!.analysisVersion).toBe('__VERSION__');
  });

  it('sets timeWindow on report', async () => {
    const engine   = new AnalysisEngine();
    const t        = Date.now();
    const sessions = buildSessions(60).map((s, i) => ({ ...s, timestamp: t + i * 1000 }));
    const reports  = await engine.analyze(sessions);
    expect(reports[0]!.timeWindow.from).toBeLessThanOrEqual(reports[0]!.timeWindow.to);
  });

  it('counts real vs synthetic sessions', async () => {
    const engine    = new AnalysisEngine();
    const real       = buildSessions(40, { synthetic: false });
    const synthetic  = buildSessions(20, { synthetic: true });
    const reports    = await engine.analyze([...real, ...synthetic]);
    expect(reports[0]!.realCount).toBe(40);
    expect(reports[0]!.syntheticCount).toBe(20);
  });

  it('produces stable suggestion ids across runs', async () => {
    const engine   = new AnalysisEngine();
    const sessions = buildSessions(60);
    const r1 = await engine.analyze(sessions);
    const r2 = await engine.analyze(sessions);
    const ids1 = r1[0]!.suggestions.map(s => s.id).sort();
    const ids2 = r2[0]!.suggestions.map(s => s.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it('uses custom agent subset — only specified agents run', async () => {
    // render-block agent needs FCP + blocking scripts; font agent needs FCP/CLS + font data
    // by specifying agents: ['render-block'], the font agent should never run
    const engine  = new AnalysisEngine({ agents: ['render-block'] });
    const sessions = Array.from({ length: 60 }, () => buildMockSession({
      metrics: {
        FCP: { name: 'FCP', value: 3500, rating: 'poor', delta: 3500, id: 'fcp-p', navigationType: 'navigate', entries: [] },
      },
      page: {
        url: 'https://example.com/',
        referrer: '',
        title: 'Test',
        domNodeCount: 100,
        resources: [],
        fonts: [{ family: 'MyFont', display: 'auto', isPreloaded: false, hasCrossOrigin: false, isSystemFont: false, isIconFont: false }],
        images: [],
        scripts: [{
          isRenderBlocking: true,
          isInline: false,
          isDeferred: false,
          isAsync: false,
          isModule: false,
          position: 'head',
          isThirdParty: false,
        }],
        stylesheets: [],
        navigationTiming: { redirectTime: 0, dnsTime: 10, tlsTime: 30, serverTime: 200, downloadTime: 50, domParseTime: 100, totalLoadTime: 500, workerTime: 0, isServiceWorker: false, redirectCount: 0 },
      },
    }));
    const reports = await engine.analyze(sessions);
    const agents  = new Set(reports[0]!.suggestions.map(s => s.agent));
    expect(agents.has('render-block')).toBe(true);
    expect(agents.has('font')).toBe(false);
  });
});
