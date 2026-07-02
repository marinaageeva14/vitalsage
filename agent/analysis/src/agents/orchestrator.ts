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

// Coarse topic taxonomy for semantic dedup. ID-based dedup only catches
// byte-identical titles — the AI restating a rule finding in different
// words, or two agents proposing the same fix (render-block and LCP both
// suggesting script deferral), previously both surfaced.
const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ['defer-scripts',    /\bdefer\b|async attribute|render.?block/i],
  ['preload-lcp',      /fetchpriority|preload.{0,30}(lcp|hero|image)/i],
  ['preconnect',       /preconnect|dns-prefetch/i],
  ['responsive-image', /srcset|responsive image|oversiz/i],
  ['image-format',     /webp|avif|image (format|compression)/i],
  ['lazy-load',        /lazy.?load/i],
  ['font-display',     /font-display|foit|fout|font swap/i],
  ['font-preload',     /preload\S*\s+\S*font|font\S*\s+\S*preload/i],
  ['long-tasks',       /long task|blocking time|scheduler\.|settimeout.{0,10}chunk|yield/i],
  ['code-split',       /code.?split|vendor bundle|tree.?shak|unused (dependencies|code)/i],
  ['dom-size',         /dom (size|nodes)|virtualiz/i],
  ['layout-thrash',    /layout thrash|forced (synchronous )?layout/i],
  ['listener-leak',    /event listener|listener leak/i],
  ['ttfb-server',      /server response|response time|\bcdn\b|edge cach/i],
  ['critical-css',     /critical css|inline.{0,10}css|unused css/i],
];

function topicOf(s: Suggestion): string | null {
  const text = `${s.title} ${s.detail}`;
  for (const [topic, re] of TOPIC_PATTERNS) {
    if (re.test(text)) return topic;
  }
  return null;
}

export function rankAndDeduplicate(suggestions: Suggestion[]): Suggestion[] {
  // Rank first, then dedup — so the highest-severity/-confidence phrasing
  // of a duplicated finding is the one that survives.
  const ranked = [...suggestions].sort((a, b) => {
    const sev: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    const sevDiff = (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.1) return confDiff;
    const eff: Record<string, number> = { low: 3, medium: 2, high: 1 };
    return (eff[b.effort] ?? 0) - (eff[a.effort] ?? 0);
  });

  const seenIds    = new Set<string>();
  const seenTopics = new Set<string>();
  return ranked.filter(s => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    const topic = topicOf(s);
    if (topic) {
      const key = `${s.metric}:${topic}`;
      if (seenTopics.has(key)) return false;
      seenTopics.add(key);
    }
    return true;
  });
}
