import type { AgentContext, Suggestion } from '@vitalsage/types';
import type { BaseAgent, AIClient, RuleBasedResult } from './base.js';

export class AgentOrchestrator {
  constructor(private agents: BaseAgent[]) {}

  async run(ctx: AgentContext, aiClient: AIClient | null): Promise<Suggestion[]> {
    const eligible = this.agents.filter(a => a.shouldRun(ctx));

    // Rule-based pass — synchronous, always runs
    const ruleResults: { agent: BaseAgent; result: RuleBasedResult }[] = eligible.map(a => ({
      agent: a,
      result: a.analyze(ctx),
    }));

    // AI enhancement — parallel, failures fall back to rule-based
    const enhanced = await Promise.allSettled(
      ruleResults.map(({ agent, result }) => agent.enhance(result, ctx, aiClient))
    );

    const all: Suggestion[] = [];
    enhanced.forEach((outcome, i) => {
      const fallback = ruleResults[i]!.result.suggestions;
      all.push(...(outcome.status === 'fulfilled' ? outcome.value.suggestions : fallback));
    });

    return rankAndDeduplicate(all);
  }
}

export function rankAndDeduplicate(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const unique = suggestions.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return unique.sort((a, b) => {
    const sev: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    const sevDiff = (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.1) return confDiff;
    const eff: Record<string, number> = { low: 3, medium: 2, high: 1 };
    return (eff[b.effort] ?? 0) - (eff[a.effort] ?? 0);
  });
}
