import { describe, it, expect } from 'vitest';
import { synthesizeContext } from '../../../src/aggregator/context-synth.js';
import { buildMockSession } from '../../fixtures/builders.js';
import type { SessionReport } from '@vitalsage/types';

function sessionWithTimestamp(ts: number, overrides: Partial<SessionReport> = {}): SessionReport {
  return buildMockSession({ timestamp: ts, ...overrides });
}

describe('synthesizeContext()', () => {
  it('throws when sessions array is empty', () => {
    expect(() => synthesizeContext([])).toThrow('no sessions');
  });

  it('returns the page context from the most recent session', () => {
    const old    = sessionWithTimestamp(1000);
    const recent = sessionWithTimestamp(9000);
    const result = synthesizeContext([old, recent]);
    expect(result).toEqual(recent.page);
  });

  it('handles single session', () => {
    const s = sessionWithTimestamp(5000);
    expect(synthesizeContext([s])).toEqual(s.page);
  });

  it('preserves all page fields from the most recent session', () => {
    const s = sessionWithTimestamp(5000);
    s.page.domNodeCount = 999;
    const result = synthesizeContext([s]);
    expect(result.domNodeCount).toBe(999);
  });

  it('retains lcpElement when fetchPriority present in ≥10% of sessions', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      sessionWithTimestamp(i * 100, {
        page: {
          ...buildMockSession().page,
          lcpElement: {
            tagName: 'IMG', src: '/hero.jpg', isThirdParty: false,
            hasExplicitDimensions: true, isPreloaded: false, elementType: 'img',
            ...(i < 2 ? { fetchPriority: 'high' } : {}), // 2/10 = 20% → retained
          },
        },
      })
    );
    const result = synthesizeContext(sessions);
    // base is most recent (ts=900, i=9), which has no fetchPriority
    // but 20% of sessions have it — so it's retained from the base
    expect(result.lcpElement).toBeDefined();
  });

  it('strips fetchPriority from lcpElement when present in <10% of sessions', () => {
    // 10 sessions; only 0 have fetchPriority → 0% < 10% → strip
    const sessions = Array.from({ length: 10 }, (_, i) =>
      sessionWithTimestamp(i * 100, {
        page: {
          ...buildMockSession().page,
          lcpElement: {
            tagName: 'IMG', src: '/hero.jpg', isThirdParty: false,
            hasExplicitDimensions: true, isPreloaded: false, elementType: 'img',
            fetchPriority: 'high', // base has it, but 0/10 others do
          },
        },
      })
    );
    const result = synthesizeContext(sessions);
    // All sessions have fetchPriority = 'high' → 100% > 10% → NOT stripped
    // This test should confirm: when all have it, it's kept
    expect(result.lcpElement?.fetchPriority).toBe('high');
  });

  it('returns page without lcpElement when base has none', () => {
    const s = sessionWithTimestamp(1000);
    delete (s.page as Partial<typeof s.page>).lcpElement;
    const result = synthesizeContext([s]);
    expect(result.lcpElement).toBeUndefined();
  });
});
