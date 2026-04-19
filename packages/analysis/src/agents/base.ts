import type { AgentName, AgentContext, MetricName, SessionReport, Suggestion } from '@vitalsage/types';
import { generateSuggestionId } from '../utils/id.js';

export interface RuleBasedResult {
  suggestions: Suggestion[];
  skipped:     boolean;
  skipReason?: string;
}

export interface AIClient {
  complete(req: { systemPrompt: string; userPrompt: string; temperature?: number; maxTokens?: number }): Promise<{ content: string }>;
}

export abstract class BaseAgent {
  abstract readonly name:            AgentName;
  abstract readonly relevantMetrics: MetricName[];

  abstract analyze(ctx: AgentContext): RuleBasedResult;

  async enhance(
    result:   RuleBasedResult,
    _ctx:     AgentContext,
    _ai:      AIClient | null,
  ): Promise<RuleBasedResult> {
    return result;
  }

  shouldRun(ctx: AgentContext): boolean {
    return this.relevantMetrics.some(m => {
      const dist = ctx.distributions[m];
      if (!dist) return false;
      return dist.rating === 'needs-improvement' || dist.rating === 'poor';
    });
  }

  protected buildSuggestion(partial: Omit<Suggestion, 'id' | 'agent'>): Suggestion {
    return {
      ...partial,
      agent: this.name,
      id:    generateSuggestionId(this.name, partial.metric, partial.title),
    };
  }

  protected formatMs(value: number): string {
    return `${Math.round(value)}ms`;
  }

  protected formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected pctBad(sessions: SessionReport[], check: (s: SessionReport) => boolean): number {
    if (sessions.length === 0) return 0;
    return sessions.filter(check).length / sessions.length;
  }
}
