import { describe, it, expect } from 'vitest';
import { groupSessionsByRoute, computeConfidence } from '../../../src/aggregator/grouping.js';
import { CONFIDENCE_THRESHOLDS } from '@vitalsage/types';
import { buildMockSession } from '../../fixtures/builders.js';

describe('groupSessionsByRoute()', () => {
  it('groups sessions by route pattern', () => {
    const home  = buildMockSession({ route: { pattern: '/',       path: '/',       visitId: 'v1', navigationIndex: 0 } });
    const about = buildMockSession({ route: { pattern: '/about',  path: '/about',  visitId: 'v2', navigationIndex: 0 } });
    const home2 = buildMockSession({ route: { pattern: '/',       path: '/',       visitId: 'v3', navigationIndex: 0 } });

    const groups = groupSessionsByRoute([home, about, home2], []);
    expect(groups.get('/')).toHaveLength(2);
    expect(groups.get('/about')).toHaveLength(1);
  });

  it('returns empty map for empty sessions array', () => {
    expect(groupSessionsByRoute([], []).size).toBe(0);
  });

  it('uses session.route.pattern as key (pattern already attached by client)', () => {
    const wildcard = buildMockSession({
      route: { pattern: '/blog/*', path: '/blog/hello', visitId: 'v1', navigationIndex: 0 },
    });
    const groups = groupSessionsByRoute([wildcard], []);
    expect(groups.has('/blog/*')).toBe(true);
  });

  it('each group contains the correct sessions', () => {
    const s1 = buildMockSession({ route: { pattern: '/posts', path: '/posts', visitId: 'v1', navigationIndex: 0 } });
    const s2 = buildMockSession({ route: { pattern: '/posts', path: '/posts', visitId: 'v2', navigationIndex: 0 } });
    const groups = groupSessionsByRoute([s1, s2], []);
    const group = groups.get('/posts')!;
    expect(group).toContain(s1);
    expect(group).toContain(s2);
  });
});

describe('computeConfidence()', () => {
  it('returns "insufficient" below low threshold', () => {
    expect(computeConfidence(0)).toBe('insufficient');
    expect(computeConfidence(CONFIDENCE_THRESHOLDS.low - 1)).toBe('insufficient');
  });

  it('returns "low" at low threshold', () => {
    expect(computeConfidence(CONFIDENCE_THRESHOLDS.low)).toBe('low');
    expect(computeConfidence(CONFIDENCE_THRESHOLDS.medium - 1)).toBe('low');
  });

  it('returns "medium" at medium threshold', () => {
    expect(computeConfidence(CONFIDENCE_THRESHOLDS.medium)).toBe('medium');
    expect(computeConfidence(CONFIDENCE_THRESHOLDS.high - 1)).toBe('medium');
  });

  it('returns "high" at or above high threshold', () => {
    expect(computeConfidence(CONFIDENCE_THRESHOLDS.high)).toBe('high');
    expect(computeConfidence(10000)).toBe('high');
  });
});
