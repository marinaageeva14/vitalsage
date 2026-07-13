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
      const affected  = sessions.filter(s => s.page.scripts.some(sc => sc.isRenderBlocking)).length;
      const totalSize = blockingScripts.reduce((sum, s) => sum + (s.size ?? 0), 0);
      // Lead the example with the largest offender — that's the one to fix first.
      const largest   = [...blockingScripts].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
      const exSrc     = largest?.src ?? '/app.js';
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'critical',
        title:  `${blockingScripts.length} render-blocking script(s) delay first paint`,
        detail: `Found ${blockingScripts.length} synchronous script(s) in <head> blocking rendering` +
                (totalSize ? ` (${Math.round(totalSize / 1024)}KB total)` : '') +
                `. Affects ${affected} of ${sessions.length} sessions.` +
                (fcp ? ` P75 FCP is ${this.formatMs(fcp.p75)}.` : '') +
                ` Add defer or async to non-critical scripts. Blocking script(s): ` +
                blockingScripts.slice(0, 3).map(s => `${s.src ?? '(inline)'}${s.size ? ` (${Math.round(s.size / 1024)}KB)` : ''}`).join(', ') +
                (blockingScripts.length > 3 ? ` and ${blockingScripts.length - 3} more.` : '.'),
        effort: 'low', estimatedImpact: '~200–800ms FCP/LCP reduction', confidence: 0.91,
        affectedSessions: affected, affectedPercent: affected / sessions.length,
        codeExample: {
          before:   `<script src="${exSrc}"></script>`,
          after:    `<script src="${exSrc}" defer></script>`,
          language: 'html',
        },
        learnMore: 'https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources',
      }));
    }

    // Rule 2: Excessive render-blocking stylesheets
    if (blockingSheets.length > 3) {
      const largestSheet = [...blockingSheets].sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0))[0];
      const exHref       = largestSheet?.href ?? '/styles.css';
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'warning',
        title:  `${blockingSheets.length} render-blocking stylesheets — consider inlining critical CSS`,
        detail: `${blockingSheets.length} CSS files block rendering. Each requires a round-trip before ` +
                `the browser can paint. Inline critical above-fold CSS and load the rest asynchronously ` +
                `using media="print" onload pattern or a CSS loading library. Blocking stylesheet(s): ` +
                blockingSheets.slice(0, 3).map(s => `${s.href ?? '(inline)'}${s.transferSize ? ` (${Math.round(s.transferSize / 1024)}KB)` : ''}`).join(', ') +
                (blockingSheets.length > 3 ? ` and ${blockingSheets.length - 3} more.` : '.'),
        effort: 'medium', estimatedImpact: '~100–400ms FCP improvement', confidence: 0.78,
        codeExample: {
          before:   `<link rel="stylesheet" href="${exHref}">`,
          after:    `<style>/* critical inline CSS extracted from ${exHref.split('/').pop()} */</style>\n<link rel="stylesheet" href="${exHref}" media="print" onload="this.media='all'">`,
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

      const aiSuggestions = parseAIResponse(response.content, this.name, 'FCP', userPrompt);

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
