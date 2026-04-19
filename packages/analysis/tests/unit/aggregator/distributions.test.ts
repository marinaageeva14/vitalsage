import { describe, it, expect } from 'vitest';
import { computeDistributions, percentile, rateMetric } from '../../../src/aggregator/distributions.js';
import { DEFAULT_THRESHOLDS } from '@vitalsage/types';
import { buildMockSession, buildSessionsWithLCP, buildMockDevice } from '../../fixtures/builders.js';

// ─── percentile ──────────────────────────────────────────────────────────────

describe('percentile()', () => {
  it('p75 of [1..10] = 7.75 (CrUX linear interpolation)', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 75)).toBeCloseTo(7.75, 5);
  });

  it('p50 of even-length array returns interpolated middle', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 5);
  });

  it('p0 returns min', () => {
    expect(percentile([5, 10, 15], 0)).toBe(5);
  });

  it('p100 returns max', () => {
    expect(percentile([5, 10, 15], 100)).toBe(15);
  });

  it('single-element array returns that element for any p', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('empty array returns 0', () => {
    expect(percentile([], 75)).toBe(0);
  });
});

// ─── rateMetric ──────────────────────────────────────────────────────────────

describe('rateMetric()', () => {
  const lcpThreshold = DEFAULT_THRESHOLDS.LCP; // good: 2500, poor: 4000

  it('at or below good threshold → good', () => {
    expect(rateMetric(2500, lcpThreshold)).toBe('good');
    expect(rateMetric(1000, lcpThreshold)).toBe('good');
  });

  it('above good but at or below poor → needs-improvement', () => {
    expect(rateMetric(2501, lcpThreshold)).toBe('needs-improvement');
    expect(rateMetric(4000, lcpThreshold)).toBe('needs-improvement');
  });

  it('above poor threshold → poor', () => {
    expect(rateMetric(4001, lcpThreshold)).toBe('poor');
    expect(rateMetric(9999, lcpThreshold)).toBe('poor');
  });

  it('CLS thresholds work (good: 0.1)', () => {
    const cls = DEFAULT_THRESHOLDS.CLS;
    expect(rateMetric(0.05, cls)).toBe('good');
    expect(rateMetric(0.15, cls)).toBe('needs-improvement');
    expect(rateMetric(0.3, cls)).toBe('poor');
  });
});

// ─── computeDistributions ────────────────────────────────────────────────────

describe('computeDistributions()', () => {
  it('returns empty object when fewer than 5 sessions have metric data', () => {
    const sessions = buildSessionsWithLCP([1000, 2000, 3000, 4000]);
    expect(computeDistributions(sessions)).toEqual({});
  });

  it('computes LCP distribution from 10 sessions', () => {
    const sessions = buildSessionsWithLCP([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = computeDistributions(sessions);
    expect(result.LCP).toBeDefined();
    expect(result.LCP!.sampleSize).toBe(10);
  });

  it('p75 of [1..10] matches CrUX linear interpolation', () => {
    const sessions = buildSessionsWithLCP([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = computeDistributions(sessions);
    expect(result.LCP!.p75).toBeCloseTo(7.75, 5);
  });

  it('min and max are correct', () => {
    const sessions = buildSessionsWithLCP([100, 200, 300, 400, 500, 600, 700]);
    const { LCP } = computeDistributions(sessions);
    expect(LCP!.min).toBe(100);
    expect(LCP!.max).toBe(700);
  });

  it('mean is correct', () => {
    const vals = [100, 200, 300, 400, 500, 600, 700];
    const sessions = buildSessionsWithLCP(vals);
    const { LCP } = computeDistributions(sessions);
    const expected = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(LCP!.mean).toBeCloseTo(expected, 5);
  });

  it('rating reflects p75 vs thresholds', () => {
    // All sessions very fast — p75 should be good
    const fastSessions = buildSessionsWithLCP([500, 600, 700, 800, 900, 1000, 1100]);
    expect(computeDistributions(fastSessions).LCP!.rating).toBe('good');

    // All sessions slow — p75 should be poor
    const slowSessions = buildSessionsWithLCP([5000, 6000, 7000, 8000, 9000, 10000, 11000]);
    expect(computeDistributions(slowSessions).LCP!.rating).toBe('poor');
  });

  it('skips metrics with fewer than 5 values even if other metrics have enough', () => {
    const sessions = buildSessionsWithLCP([1000, 2000, 3000, 4000, 5000]);
    // FCP not set — should be absent
    const result = computeDistributions(sessions);
    expect(result.FCP).toBeUndefined();
    expect(result.LCP).toBeDefined();
  });

  it('histogram has 10 buckets and percentages sum to ~100', () => {
    const sessions = buildSessionsWithLCP([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const { histogram } = computeDistributions(sessions).LCP!;
    expect(histogram).toHaveLength(10);
    const total = histogram.reduce((s, b) => s + b.percentage, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('filters non-finite values', () => {
    const sessions = [
      ...buildSessionsWithLCP([1000, 2000, 3000, 4000, 5000]),
      buildMockSession({ metrics: { LCP: { name: 'LCP', value: NaN, rating: 'good', delta: 0, id: 'nan', navigationType: 'navigate', entries: [] } } }),
      buildMockSession({ metrics: { LCP: { name: 'LCP', value: Infinity, rating: 'good', delta: 0, id: 'inf', navigationType: 'navigate', entries: [] } } }),
    ];
    const result = computeDistributions(sessions);
    expect(result.LCP!.sampleSize).toBe(5);
  });

  it('byDevice groups mobile and desktop separately', () => {
    const desktop = Array.from({ length: 6 }, (_, i) =>
      buildMockSession({ metrics: { LCP: { name: 'LCP', value: 1000 + i * 100, rating: 'good', delta: 0, id: `d${i}`, navigationType: 'navigate', entries: [] } } })
    );
    const mobile = Array.from({ length: 6 }, (_, i) =>
      buildMockSession({
        device: buildMockDevice({ deviceCategory: 'mobile' }),
        metrics: { LCP: { name: 'LCP', value: 3000 + i * 100, rating: 'needs-improvement', delta: 0, id: `m${i}`, navigationType: 'navigate', entries: [] } },
      })
    );
    const result = computeDistributions([...desktop, ...mobile]);
    expect(result.LCP!.byDevice.desktop).toBeDefined();
    expect(result.LCP!.byDevice.mobile).toBeDefined();
    expect(result.LCP!.byDevice.mobile!.p75).toBeGreaterThan(result.LCP!.byDevice.desktop!.p75);
  });

  it('byDevice omits groups with fewer than 5 sessions', () => {
    const sessions = [
      ...buildSessionsWithLCP([1000, 2000, 3000, 4000, 5000]),
      // Only 2 mobile sessions — below threshold
      buildMockSession({ device: buildMockDevice({ deviceCategory: 'mobile' }), metrics: { LCP: { name: 'LCP', value: 3000, rating: 'poor', delta: 0, id: 'm1', navigationType: 'navigate', entries: [] } } }),
      buildMockSession({ device: buildMockDevice({ deviceCategory: 'mobile' }), metrics: { LCP: { name: 'LCP', value: 3500, rating: 'poor', delta: 0, id: 'm2', navigationType: 'navigate', entries: [] } } }),
    ];
    const result = computeDistributions(sessions);
    expect(result.LCP!.byDevice.mobile).toBeUndefined();
  });

  it('uses custom thresholds when provided', () => {
    const sessions = buildSessionsWithLCP([3000, 3100, 3200, 3300, 3400]);
    // Default LCP good = 2500 → these would be needs-improvement
    const defaultResult = computeDistributions(sessions);
    expect(defaultResult.LCP!.rating).toBe('needs-improvement');

    // With raised good threshold → same values are now good
    const customThresholds = { ...DEFAULT_THRESHOLDS, LCP: { good: 4000, poor: 6000 } };
    const customResult = computeDistributions(sessions, customThresholds);
    expect(customResult.LCP!.rating).toBe('good');
  });
});
