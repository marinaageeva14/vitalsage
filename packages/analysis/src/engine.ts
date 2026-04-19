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

const ALL_AGENTS: BaseAgent[] = [
  new LCPAgent(),
  new CLSAgent(),
  new INPAgent(),
  new TTFBAgent(),
  new RenderBlockAgent(),
  new ResourceHintAgent(),
  new ImageAgent(),
  new FontAgent(),
];

function mergeThresholds(partial?: Partial<ThresholdConfig>): ThresholdConfig {
  if (!partial) return DEFAULT_THRESHOLDS;
  return { ...DEFAULT_THRESHOLDS, ...partial };
}

function resolveAgents(spec: EngineConfig['agents']): BaseAgent[] {
  if (!spec || spec === 'all') return ALL_AGENTS;
  return ALL_AGENTS.filter(a => (spec as string[]).includes(a.name));
}

export class AnalysisEngine {
  private agents:     BaseAgent[];
  private aiClient:   AIClient | null;
  private thresholds: ThresholdConfig;

  constructor(config: EngineConfig = {}) {
    this.thresholds = mergeThresholds(config.thresholds);
    this.aiClient   = config.ai ? resolveProvider(config.ai) : null;
    this.agents     = resolveAgents(config.agents);
  }

  async analyze(
    sessions: SessionReport[],
    options:  AnalysisOptions = {},
  ): Promise<AnalysisReport[]> {
    if (!sessions.length) return [];

    let filtered = sessions;

    if (options.timeWindow) {
      filtered = filtered.filter(s =>
        s.timestamp >= options.timeWindow!.from &&
        s.timestamp <= options.timeWindow!.to
      );
    }
    if (options.includeRealOnly)      filtered = filtered.filter(s => !s.synthetic);
    if (options.includeSyntheticOnly) filtered = filtered.filter(s => s.synthetic);

    const groups = groupSessionsByRoute(filtered, []);
    const results: AnalysisReport[] = [];

    for (const [, routeSessions] of groups) {
      if (routeSessions.length < (options.minSamples ?? 50)) {
        if (routeSessions.length > 0) {
          results.push(this.buildInsufficientReport(routeSessions));
        }
        continue;
      }
      results.push(await this.analyzeRoute(routeSessions));
    }

    return results.sort((a, b) => b.sampleSize - a.sampleSize);
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

    const enhanced = await Promise.allSettled(
      ruleResults.map(({ agent, result }) => agent.enhance(result, agentCtx, this.aiClient))
    );

    const allSuggestions: Suggestion[] = [];
    enhanced.forEach((outcome, i) => {
      const fallback = ruleResults[i]!.result.suggestions;
      allSuggestions.push(
        ...(outcome.status === 'fulfilled' ? outcome.value.suggestions : fallback)
      );
    });

    const latest = sessions[0]!;

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
