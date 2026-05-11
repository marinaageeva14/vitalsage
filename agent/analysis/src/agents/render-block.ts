import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildRenderBlockPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAIResponse } from '../ai/parser.js';

export class RenderBlockAgent extends BaseAgent {
  readonly name: AgentName = 'render-block';
  readonly relevantMetrics: MetricName[] = ['FCP', 'LCP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const fcp = ctx.distributions.FCP;
    const lcp = ctx.distributions.LCP;
    if (!fcp && !lcp) return { suggestions: [], skipped: true, skipReason: 'No FCP or LCP data' };

    const suggestions = [];
    const sessions = ctx.sessions;

    const blockingScripts = ctx.representativePage.scripts.filter(s => s.isRenderBlocking);
    const blockingSheets  = ctx.representativePage.stylesheets.filter(s => s.isRenderBlocking);

    // Rule 1: Render-blocking scripts
    if (blockingScripts.length > 0) {
      const affected = sessions.filter(s => s.page.scripts.some(sc => sc.isRenderBlocking)).length;
      const totalSize = blockingScripts.reduce((sum, s) => sum + (s.size ?? 0), 0);
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'critical',
        title:  `${blockingScripts.length} render-blocking script(s) delay first paint`,
        detail: `Found ${blockingScripts.length} synchronous script(s) in <head> blocking rendering` +
                (totalSize ? ` (${Math.round(totalSize / 1024)}KB total)` : '') +
                `. Affects ${affected} of ${sessions.length} sessions.` +
                (fcp ? ` P75 FCP is ${this.formatMs(fcp.p75)}.` : '') +
                ` Add defer or async to non-critical scripts.`,
        effort: 'low', estimatedImpact: '~200–800ms FCP/LCP reduction', confidence: 0.91,
        affectedSessions: affected, affectedPercent: affected / sessions.length,
        codeExample: {
          before:   `<script src="/app.js"></script>`,
          after:    `<script src="/app.js" defer></script>`,
          language: 'html',
        },
        learnMore: 'https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources',
      }));
    }

    // Rule 2: Excessive render-blocking stylesheets
    if (blockingSheets.length > 3) {
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'warning',
        title:  `${blockingSheets.length} render-blocking stylesheets — consider inlining critical CSS`,
        detail: `${blockingSheets.length} CSS files block rendering. Each requires a round-trip before ` +
                `the browser can paint. Inline critical above-fold CSS and load the rest asynchronously ` +
                `using media="print" onload pattern or a CSS loading library.`,
        effort: 'medium', estimatedImpact: '~100–400ms FCP improvement', confidence: 0.78,
        codeExample: {
          before:   `<link rel="stylesheet" href="/styles.css">`,
          after:    `<style>/* critical inline CSS */</style>\n<link rel="stylesheet" href="/styles.css" media="print" onload="this.media='all'">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/extract-critical-css',
      }));
    }

    return { suggestions, skipped: false };
  }

  async enhance(
    result: RuleBasedResult,
    ctx:    AgentContext,
    ai:     AIClient | null,
  ): Promise<RuleBasedResult> {
    if (!ai || result.skipped) return result;

    try {
      const userPrompt = buildRenderBlockPrompt(
        ctx.distributions.FCP,
        ctx.distributions.LCP,
        ctx.representativePage,
        ctx.sampleSize,
        ctx.confidence,
        result.suggestions,
      );

      const response = await ai.complete({
        systemPrompt: AI_SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.2,
        maxTokens:   1000,
      });

      const aiSuggestions = parseAIResponse(response.content, this.name, 'FCP');

      const aiTitlesNorm = new Set(
        aiSuggestions.map(s => s.title.toLowerCase().slice(0, 40))
      );
      const dedupedRules = result.suggestions.filter(
        s => !aiTitlesNorm.has(s.title.toLowerCase().slice(0, 40))
      );

      return { ...result, suggestions: [...dedupedRules, ...aiSuggestions] };
    } catch {
      return result;
    }
  }
}
