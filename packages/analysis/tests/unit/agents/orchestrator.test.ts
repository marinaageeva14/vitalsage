import { describe, it, expect, vi } from 'vitest';
import type { AgentContext, Suggestion, AgentName, MetricName } from '@vitalsage/types';
import { DEFAULT_THRESHOLDS, CONFIDENCE_THRESHOLDS } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from '../../../src/agents/base.js';
import { AgentOrchestrator, rankAndDeduplicate } from '../../../src/agents/orchestrator.js';
import { buildMockSession, buildMockPage } from '../../fixtures/builders.js';
import { computeDistributions } from '../../../src/aggregator/distributions.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id:              'test-id',
    agent:           'lcp',
    metric:          'LCP',
    severity:        'warning',
    title:           'Test suggestion',
    detail:          'Detail text',
    effort:          'low',
    estimatedImpact: 'small',
    confidence:      0.8,
    ...overrides,
  };
}

class StubAgent extends BaseAgent {
  readonly name: AgentName;
  readonly relevantMetrics: MetricName[];
  private result: RuleBasedResult;

  constructor(name: AgentName, metrics: MetricName[], result: RuleBasedResult) {
    super();
    this.name = name;
    this.relevantMetrics = metrics;
    this.result = result;
  }

  analyze(_ctx: AgentContext): RuleBasedResult {
    return this.result;
  }
}

function buildCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    buildMockSession({
      metrics: { LCP: { name: 'LCP', value: 5000 + i * 100, rating: 'poor', delta: 0, id: `l${i}`, navigationType: 'navigate', entries: [] } },
    })
  );
  return {
    distributions:      computeDistributions(sessions),
    representativePage: buildMockPage(),
    sessions,
    sampleSize:         sessions.length,
    confidence:         'low',
    thresholds:         DEFAULT_THRESHOLDS,
    ...overrides,
  };
}

// ─── rankAndDeduplicate ───────────────────────────────────────────────────────

describe('rankAndDeduplicate()', () => {
  it('deduplicates by id', () => {
    const s = makeSuggestion({ id: 'dup' });
    expect(rankAndDeduplicate([s, s, s])).toHaveLength(1);
  });

  it('sorts critical before warning before info', () => {
    const info     = makeSuggestion({ id: '1', severity: 'info',     confidence: 0.9 });
    const warning  = makeSuggestion({ id: '2', severity: 'warning',  confidence: 0.9 });
    const critical = makeSuggestion({ id: '3', severity: 'critical', confidence: 0.9 });
    const result = rankAndDeduplicate([info, critical, warning]);
    expect(result[0]!.severity).toBe('critical');
    expect(result[1]!.severity).toBe('warning');
    expect(result[2]!.severity).toBe('info');
  });

  it('breaks ties by confidence (higher first)', () => {
    const lo = makeSuggestion({ id: '1', severity: 'warning', confidence: 0.5 });
    const hi = makeSuggestion({ id: '2', severity: 'warning', confidence: 0.95 });
    const result = rankAndDeduplicate([lo, hi]);
    expect(result[0]!.id).toBe('2');
  });

  it('breaks confidence ties by effort (low effort first)', () => {
    const hard = makeSuggestion({ id: '1', severity: 'warning', confidence: 0.8, effort: 'high' });
    const easy = makeSuggestion({ id: '2', severity: 'warning', confidence: 0.8, effort: 'low' });
    const result = rankAndDeduplicate([hard, easy]);
    expect(result[0]!.effort).toBe('low');
  });

  it('preserves unique suggestions', () => {
    const a = makeSuggestion({ id: 'a' });
    const b = makeSuggestion({ id: 'b' });
    expect(rankAndDeduplicate([a, b])).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(rankAndDeduplicate([])).toEqual([]);
  });
});

// ─── AgentOrchestrator ────────────────────────────────────────────────────────

describe('AgentOrchestrator', () => {
  it('runs agents whose shouldRun() returns true', async () => {
    const ctx = buildCtx();
    const suggestion = makeSuggestion({ id: 'lcp-1' });
    const agent = new StubAgent('lcp', ['LCP'], { suggestions: [suggestion], skipped: false });
    const orch = new AgentOrchestrator([agent]);
    const result = await orch.run(ctx, null);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('lcp-1');
  });

  it('skips agents whose relevantMetrics have no poor/needs-improvement distributions', async () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      buildMockSession({
        metrics: { LCP: { name: 'LCP', value: 500 + i * 10, rating: 'good', delta: 0, id: `g${i}`, navigationType: 'navigate', entries: [] } },
      })
    );
    const ctx = buildCtx({
      distributions: computeDistributions(sessions),
      sessions,
    });
    const agent = new StubAgent('lcp', ['LCP'], { suggestions: [makeSuggestion()], skipped: false });
    const orch = new AgentOrchestrator([agent]);
    const result = await orch.run(ctx, null);
    expect(result).toHaveLength(0);
  });

  it('falls back to rule-based result when AI enhance() throws', async () => {
    const ctx = buildCtx();
    const suggestion = makeSuggestion({ id: 'rb-1' });
    const agent = new StubAgent('lcp', ['LCP'], { suggestions: [suggestion], skipped: false });
    vi.spyOn(agent, 'enhance').mockRejectedValue(new Error('AI timeout'));
    const orch = new AgentOrchestrator([agent]);
    const result = await orch.run(ctx, null);
    expect(result[0]!.id).toBe('rb-1');
  });

  it('merges suggestions from multiple agents', async () => {
    const ctx = buildCtx();
    const lcpSug = makeSuggestion({ id: 'lcp-sug', agent: 'lcp', severity: 'critical' });
    const clsSug = makeSuggestion({ id: 'cls-sug', agent: 'cls', severity: 'warning' });
    const lcpAgent = new StubAgent('lcp', ['LCP'], { suggestions: [lcpSug], skipped: false });
    const clsAgent = new StubAgent('cls', ['LCP'], { suggestions: [clsSug], skipped: false });
    const orch = new AgentOrchestrator([lcpAgent, clsAgent]);
    const result = await orch.run(ctx, null);
    expect(result).toHaveLength(2);
    expect(result[0]!.severity).toBe('critical');
  });

  it('deduplicates suggestions with same id from multiple agents', async () => {
    const ctx = buildCtx();
    const dupSug = makeSuggestion({ id: 'dup-id' });
    const a1 = new StubAgent('lcp', ['LCP'], { suggestions: [dupSug], skipped: false });
    const a2 = new StubAgent('cls', ['LCP'], { suggestions: [dupSug], skipped: false });
    const orch = new AgentOrchestrator([a1, a2]);
    const result = await orch.run(ctx, null);
    expect(result).toHaveLength(1);
  });

  it('passes aiClient to enhance()', async () => {
    const ctx = buildCtx();
    const agent = new StubAgent('lcp', ['LCP'], { suggestions: [], skipped: false });
    const mockAI: AIClient = { complete: vi.fn().mockResolvedValue({ content: '' }) };
    const enhanceSpy = vi.spyOn(agent, 'enhance').mockResolvedValue({ suggestions: [], skipped: false });
    const orch = new AgentOrchestrator([agent]);
    await orch.run(ctx, mockAI);
    expect(enhanceSpy).toHaveBeenCalledWith(expect.anything(), ctx, mockAI);
  });
});
