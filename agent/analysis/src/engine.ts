import type {
  SessionReport,
  AnalysisReport,
  AnalysisOptions,
  AgentContext,
  Suggestion,
  ThresholdConfig,
  EngineConfig,
} from '@vitalsage/types';
import { DEFAULT_THRESHOLDS } from '@vitalsage/types';
import { computeDistributions }  from './aggregator/distributions.js';
import { groupSessionsByRoute, computeConfidence } from './aggregator/grouping.js';
import { synthesizeContext }     from './aggregator/context-synth.js';
import { rankAndDeduplicate }    from './agents/orchestrator.js';
import { resolveProvider }       from './ai/client.js';
import { generateId }            from './utils/id.js';
import type { BaseAgent }        from './agents/base.js';
import type { AIClient }         from './agents/base.js';

import { LCPAgent }          from './agents/lcp.js';
import { CLSAgent }          from './agents/cls.js';
import { INPAgent }          from './agents/inp.js';
import { TTFBAgent }         from './agents/ttfb.js';
import { RenderBlockAgent }  from './agents/render-block.js';
import { ResourceHintAgent } from './agents/resource-hint.js';
import { ImageAgent }        from './agents/image.js';
import { FontAgent }         from './agents/font.js';
import { TraceAgent }        from './agents/trace.js';

const ALL_AGENTS: BaseAgent[] = [
  new LCPAgent(),
  new CLSAgent(),
  new INPAgent(),
  new TTFBAgent(),
  new RenderBlockAgent(),
  new ResourceHintAgent(),
  new ImageAgent(),
  new FontAgent(),
  new TraceAgent(),
];

function mergeThresholds(partial?: Partial<ThresholdConfig>): ThresholdConfig {
  if (!partial) return DEFAULT_THRESHOLDS;
  return { ...DEFAULT_THRESHOLDS, ...partial };
}

function resolveAgents(spec: EngineConfig['agents']): BaseAgent[] {
  if (!spec || spec === 'all') return ALL_AGENTS;
  return ALL_AGENTS.filter(a => (spec as string[]).includes(a.name));
}

/**
 * Wraps the AI client so every enhance() call is measured. Agents swallow
 * their own errors (falling back to rule-based results), which previously
 * made "AI failed" indistinguishable from "AI found nothing" — the recorder
 * sees the error before the agent's catch does.
 */
class RecordingAIClient implements AIClient {
  calls      = 0;
  succeeded  = 0;
  failed     = 0;
  timedOut   = 0;
  tokensUsed = 0;
  durationMs = 0;
  errors     = new Set<string>();

  constructor(private inner: AIClient, private providerName: string) {}

  async complete(req: { systemPrompt: string; userPrompt: string; temperature?: number; maxTokens?: number }): Promise<{ content: string }> {
    this.calls++;
    const start = Date.now();
    try {
      const res = await this.inner.complete(req);
      this.succeeded++;
      const tokens = (res as { tokensUsed?: number }).tokensUsed;
      if (typeof tokens === 'number') this.tokensUsed += tokens;
      return res;
    } catch (err) {
      this.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AITimeoutError') this.timedOut++;
      if (this.errors.size < 3) this.errors.add(msg);
      throw err;
    } finally {
      this.durationMs += Date.now() - start;
    }
  }

  telemetry(): import('@vitalsage/types').AIEnhancementTelemetry {
    return {
      provider:   this.providerName,
      calls:      this.calls,
      succeeded:  this.succeeded,
      failed:     this.failed,
      timedOut:   this.timedOut,
      tokensUsed: this.tokensUsed,
      durationMs: this.durationMs,
      ...(this.errors.size ? { errors: [...this.errors] } : {}),
    };
  }
}

export class AnalysisEngine {
  private agents:       BaseAgent[];
  private aiClient:     AIClient | null;
  private providerName: string;
  private thresholds:   ThresholdConfig;

  constructor(config: EngineConfig = {}) {
    this.thresholds   = mergeThresholds(config.thresholds);
    this.aiClient     = config.ai ? resolveProvider(config.ai) : null;
    this.providerName = config.ai
      ? (typeof config.ai.provider === 'string' ? config.ai.provider : config.ai.provider.name)
      : 'none';
    this.agents       = resolveAgents(config.agents);
  }

  async analyze(
    sessions: SessionReport[],
    options:  AnalysisOptions = {},
  ): Promise<AnalysisReport[]> {
    const results: AnalysisReport[] = [];
    for await (const report of this.analyzeStream(sessions, options)) {
      results.push(report);
    }
    return results.sort((a, b) => b.sampleSize - a.sampleSize);
  }

  /**
   * Streaming variant — yields one `AnalysisReport` per route as it completes.
   *
   * Use this when you want to push results to the client progressively (e.g.
   * SSE or NDJSON) instead of waiting for all routes to finish.  With AI
   * enhancement enabled, each route takes ~1-3 s for the LLM call; streaming
   * means the first route's findings arrive immediately rather than after all
   * routes are analysed.
   */
  async *analyzeStream(
    sessions: SessionReport[],
    options:  AnalysisOptions = {},
  ): AsyncGenerator<AnalysisReport> {
    if (!sessions.length) return;

    let filtered = sessions;

    if (options.timeWindow) {
      filtered = filtered.filter(s =>
        s.timestamp >= options.timeWindow!.from &&
        s.timestamp <= options.timeWindow!.to
      );
    }
    if (options.includeRealOnly)      filtered = filtered.filter(s => !s.synthetic);
    if (options.includeSyntheticOnly) filtered = filtered.filter(s => s.synthetic);

    const groups      = groupSessionsByRoute(filtered, []);
    const minSamples  = options.minSamples ?? 50;

    for (const [, routeSessions] of groups) {
      if (routeSessions.length < minSamples) {
        if (routeSessions.length > 0) yield this.buildInsufficientReport(routeSessions);
        continue;
      }
      yield await this.analyzeRoute(routeSessions);
    }
  }

  private async analyzeRoute(sessions: SessionReport[]): Promise<AnalysisReport> {
    const distributions      = computeDistributions(sessions, this.thresholds);
    const representativePage = synthesizeContext(sessions);
    const confidence         = computeConfidence(sessions.length);

    const agentCtx: AgentContext = {
      distributions,
      representativePage,
      sessions,
      sampleSize: sessions.length,
      confidence,
      thresholds: this.thresholds,
    };

    const eligible   = this.agents.filter(a => a.shouldRun(agentCtx));
    const ruleResults = eligible.map(a => ({ agent: a, result: a.analyze(agentCtx) }));

    const recorder = this.aiClient ? new RecordingAIClient(this.aiClient, this.providerName) : null;
    const enhanced = await Promise.allSettled(
      ruleResults.map(({ agent, result }) => agent.enhance(result, agentCtx, recorder))
    );

    const allSuggestions: Suggestion[] = [];
    enhanced.forEach((outcome, i) => {
      const fallback = ruleResults[i]!.result.suggestions;
      allSuggestions.push(
        ...(outcome.status === 'fulfilled' ? outcome.value.suggestions : fallback)
      );
    });

    const latest       = sessions[0]!;
    const screenshot   = sessions.find(s => s.page.screenshot)?.page.screenshot;
    const traceMetrics = sessions.find(s => s.page.traceMetrics)?.page.traceMetrics;

    return {
      analysisId:      generateId(),
      generatedAt:     Date.now(),
      route:           latest.route,
      sampleSize:      sessions.length,
      syntheticCount:  sessions.filter(s => s.synthetic).length,
      realCount:       sessions.filter(s => !s.synthetic).length,
      timeWindow: {
        from: Math.min(...sessions.map(s => s.timestamp)),
        to:   Math.max(...sessions.map(s => s.timestamp)),
      },
      confidence,
      distributions,
      suggestions:     rankAndDeduplicate(allSuggestions),
      analysisVersion: '__VERSION__',
      ...(screenshot   ? { screenshot }   : {}),
      ...(traceMetrics ? { traceMetrics } : {}),
      ...(recorder     ? { ai: recorder.telemetry() } : {}),
    };
  }

  private buildInsufficientReport(sessions: SessionReport[]): AnalysisReport {
    const latest = sessions[0]!;
    return {
      analysisId:      generateId(),
      generatedAt:     Date.now(),
      route:           latest.route,
      sampleSize:      sessions.length,
      syntheticCount:  0,
      realCount:       sessions.length,
      timeWindow:      { from: latest.timestamp, to: latest.timestamp },
      confidence:      'insufficient',
      distributions:   {},
      suggestions: [{
        id:              'insufficient-data',
        agent:           'lcp',
        metric:          'LCP',
        severity:        'info',
        title:           `Only ${sessions.length} sessions collected — insufficient for reliable analysis`,
        detail:          `Need at least 50 sessions per route for analysis. ` +
                         `Run vitalsage simulate to generate synthetic data immediately.`,
        effort:          'low',
        estimatedImpact: 'N/A',
        confidence:      1.0,
      }],
      analysisVersion: '__VERSION__',
    };
  }
}
