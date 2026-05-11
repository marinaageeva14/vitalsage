import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildCLSPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAIResponse } from '../ai/parser.js';

export class CLSAgent extends BaseAgent {
  readonly name: AgentName = 'cls';
  readonly relevantMetrics: MetricName[] = ['CLS'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const cls = ctx.distributions.CLS;
    if (!cls) return { suggestions: [], skipped: true, skipReason: 'No CLS data' };

    const suggestions = [];
    const sessions = ctx.sessions;

    // Rule 1: Unsized images (missing explicit dimensions)
    const unsizedPct = this.pctBad(sessions, s =>
      s.page.images.some(img => !img.hasExplicitDimensions && img.isAboveFold)
    );
    if (unsizedPct > 0.3) {
      suggestions.push(this.buildSuggestion({
        metric: 'CLS', severity: cls.p75 > 0.25 ? 'critical' : 'warning',
        title:  `Above-fold images without explicit dimensions cause layout shifts in ${this.formatPercent(unsizedPct)} of sessions`,
        detail: `P75 CLS is ${cls.p75.toFixed(3)}. Images without width/height attributes cause the browser ` +
                `to allocate no space for them initially, then re-lay out the page when they load. ` +
                `Found in ${this.formatPercent(unsizedPct)} of sessions.`,
        effort: 'low', estimatedImpact: 'Eliminates image-triggered layout shifts', confidence: 0.9,
        affectedPercent: unsizedPct,
        codeExample: {
          before:   `<img src="/hero.jpg" alt="Hero">`,
          after:    `<img src="/hero.jpg" alt="Hero" width="1200" height="600">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/cls',
      }));
    }

    // Rule 2: Fonts without font-display: swap/optional
    const badFontPct = this.pctBad(sessions, s =>
      s.page.fonts.some(f => !f.isSystemFont && (f.display === 'auto' || f.display === 'block'))
    );
    if (badFontPct > 0.3) {
      suggestions.push(this.buildSuggestion({
        metric: 'CLS', severity: 'warning',
        title:  `Web fonts using font-display:auto/block cause FOUT shifts in ${this.formatPercent(badFontPct)} of sessions`,
        detail: `Fonts without font-display:swap can cause invisible text (FOIT) then a sudden text relayout ` +
                `when the font loads — a common CLS source. P75 CLS is ${cls.p75.toFixed(3)}.`,
        effort: 'low', estimatedImpact: '~0.05–0.15 CLS reduction', confidence: 0.82,
        affectedPercent: badFontPct,
        codeExample: {
          before:   `@font-face { font-family: "MyFont"; src: url("/font.woff2"); }`,
          after:    `@font-face { font-family: "MyFont"; src: url("/font.woff2"); font-display: swap; }`,
          language: 'css',
        },
        learnMore: 'https://web.dev/articles/font-display',
      }));
    }

    // Rule 3: Very high CLS — likely injected banners
    if (cls.p75 > 0.25) {
      suggestions.push(this.buildSuggestion({
        metric: 'CLS', severity: 'critical',
        title:  `P75 CLS of ${cls.p75.toFixed(3)} is in the "poor" range — reserve space for dynamic content`,
        detail: `CLS above 0.25 typically indicates dynamically injected content (cookie banners, ads, ` +
                `or notifications) that pushes page content down. Reserve explicit height for these containers ` +
                `or load them in a way that does not shift existing content.`,
        effort: 'medium', estimatedImpact: 'Could reduce CLS below 0.1 threshold', confidence: 0.75,
        learnMore: 'https://web.dev/articles/optimize-cls',
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
      const userPrompt = buildCLSPrompt(
        ctx.distributions.CLS!,
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

      const aiSuggestions = parseAIResponse(response.content, this.name, 'CLS');

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
