import { describe, it, expect } from 'vitest';
import { validateGrounding } from '../../../src/ai/grounding.js';
import type { Suggestion } from '@vitalsage/types';

function makeSuggestion(partial: Partial<Suggestion>): Suggestion {
  return {
    id:              'test-id',
    agent:           'lcp',
    metric:          'LCP',
    severity:        'warning',
    title:           'Test suggestion',
    detail:          '',
    effort:          'low',
    estimatedImpact: '',
    confidence:      0.8,
    ...partial,
  };
}

const PROMPT = `
## LCP Distribution
LCP: p50=3100ms p75=4300ms p95=6423ms [poor] n=3

## Main Thread
Total Blocking Time: 107ms across 3 long task(s)
Forced layout count: 6
Style recalculation count: 18
`;

describe('validateGrounding', () => {
  it('keeps a suggestion whose numbers appear in the prompt', () => {
    const s = makeSuggestion({
      title:  'LCP p75 is 4300ms — optimize the hero image',
      detail: 'At p75 of 4300ms with 107ms TBT, the LCP resource loads late.',
    });
    const { kept, dropped } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    expect(kept[0]!.confidence).toBe(0.8);
  });

  it('drops a suggestion built on fabricated values (live oyyo failure)', () => {
    const s = makeSuggestion({
      metric: 'TTFB',
      title:  'Reduce the 639ms spent on style recalculation',
      detail: 'The 639ms of style recalculation is delaying the response.',
    });
    const { kept, dropped } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reasons.join(' ')).toContain('639');
  });

  it('drops a causally impossible metric/cause pairing', () => {
    const s = makeSuggestion({
      metric: 'TTFB',
      title:  'Forced layouts are slowing TTFB',
      detail: 'The forced layout count of 6 is likely causing high TTFB.',
    });
    const { kept, dropped } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reasons[0]).toContain('cannot affect TTFB');
  });

  it('allows TTFB suggestions with plausible causes', () => {
    const s = makeSuggestion({
      metric: 'TTFB',
      title:  'Server response time dominates TTFB',
      detail: 'Consider a CDN or server-side caching to reduce origin response time.',
    });
    const { kept } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(1);
  });

  it('halves confidence when a minority of numbers are unverifiable', () => {
    const s = makeSuggestion({
      title:  'LCP is 4300ms and 107ms is blocked',
      detail: 'The 4300ms LCP with 107ms TBT suggests roughly 250ms of savings available.',
      confidence: 0.9,
    });
    const { kept } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.confidence).toBe(0.45);
  });

  it('does not ground numbers in estimatedImpact (projections are allowed)', () => {
    const s = makeSuggestion({
      title:           'LCP p75 is 4300ms',
      detail:          'The hero image at p75 4300ms lacks priority hints.',
      estimatedImpact: '~350-500ms LCP reduction',
    });
    const { kept } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.confidence).toBe(0.8);
  });

  it('accepts ±1 rounding differences', () => {
    const s = makeSuggestion({
      title:  'TBT of 108ms observed',
      detail: 'Main thread blocked for 108ms total.',
    });
    const { kept } = validateGrounding([s], PROMPT);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.confidence).toBe(0.8);
  });
});
