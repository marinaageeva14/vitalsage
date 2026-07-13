import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildFontPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAIResponse } from '../ai/parser.js';

export class FontAgent extends BaseAgent {
  readonly name: AgentName = 'font';
  readonly relevantMetrics: MetricName[] = ['CLS', 'FCP', 'LCP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const fcp = ctx.distributions.FCP;
    const cls = ctx.distributions.CLS;
    if (!fcp && !cls) return { suggestions: [], skipped: true, skipReason: 'No FCP or CLS data' };

    const suggestions = [];
    const sessions = ctx.sessions;
    const page = ctx.representativePage;

    const webFonts = page.fonts.filter(f => !f.isSystemFont && !f.isIconFont);

    // Rule 1: Fonts not preloaded
    const unpreloadedFonts = webFonts.filter(f => !f.isPreloaded && f.url);
    if (unpreloadedFonts.length > 0 && fcp) {
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: fcp.rating === 'poor' ? 'critical' : 'warning',
        title:  `${unpreloadedFonts.length} web font(s) not preloaded — browser discovers them late`,
        detail: `Found ${unpreloadedFonts.length} web font(s) without <link rel="preload">. The browser ` +
                `only discovers fonts when parsing CSS, adding a full render-blocking delay before text can ` +
                `be displayed. P75 FCP is ${this.formatMs(fcp.p75)}. Affected font(s): ` +
                `${unpreloadedFonts.slice(0, 5).map(f => f.family ?? f.url).join(', ')}` +
                (unpreloadedFonts.length > 5 ? ` and ${unpreloadedFonts.length - 5} more.` : '.'),
        effort: 'low', estimatedImpact: '~100–300ms FCP improvement', confidence: 0.84,
        codeExample: {
          before:   `<!-- ${unpreloadedFonts[0]!.url} is discovered only when CSS is parsed -->`,
          after:    `<link rel="preload" as="font" href="${unpreloadedFonts[0]!.url}" type="font/woff2" crossorigin>`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/codelab-preload-web-fonts',
      }));
    }

    // Rule 2: Preloaded fonts missing crossorigin attribute
    const missingCrossorigin = webFonts.filter(f => f.isPreloaded && !f.hasCrossOrigin && f.url);
    if (missingCrossorigin.length > 0) {
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'critical',
        title:  `${missingCrossorigin.length} preloaded font(s) missing crossorigin — preload is ignored`,
        detail: `Font preloads without crossorigin="anonymous" are silently ignored by the browser because ` +
                `fonts always use CORS. This means the preload hint does nothing and the font is still ` +
                `discovered late. This is a common misconfiguration. Affected font(s): ` +
                `${missingCrossorigin.slice(0, 5).map(f => f.family ?? f.url).join(', ')}` +
                (missingCrossorigin.length > 5 ? ` and ${missingCrossorigin.length - 5} more.` : '.'),
        effort: 'low', estimatedImpact: 'Activates existing preload hints', confidence: 0.97,
        codeExample: {
          before:   `<link rel="preload" as="font" href="${missingCrossorigin[0]!.url}">`,
          after:    `<link rel="preload" as="font" href="${missingCrossorigin[0]!.url}" crossorigin>`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/preload-critical-assets#fonts',
      }));
    }

    // Rule 3: Fonts without font-display (CLS / FCP correlation)
    const badDisplayPct = this.pctBad(sessions, s =>
      s.page.fonts.some(f => !f.isSystemFont && (f.display === 'auto' || f.display === 'block'))
    );
    if (badDisplayPct > 0.4) {
      const metric     = cls?.rating === 'poor' || cls?.rating === 'needs-improvement' ? 'CLS' : 'FCP';
      const badFont    = page.fonts.find(f => !f.isSystemFont && (f.display === 'auto' || f.display === 'block'));
      const fontFamily = badFont?.family ?? 'MyFont';
      const fontUrl    = badFont?.url    ?? '/font.woff2';
      suggestions.push(this.buildSuggestion({
        metric: metric as MetricName, severity: 'warning',
        title:  `${this.formatPercent(badDisplayPct)} of sessions have fonts without font-display:swap`,
        detail: `Fonts using font-display:auto or block hide text until the font loads (FOIT), ` +
                `then cause a relayout when the font becomes available — a direct CLS source. ` +
                `Use font-display:swap for body text or font-display:optional for decorative fonts.` +
                (badFont ? ` Affected font: ${fontFamily}.` : ''),
        effort: 'low', estimatedImpact: 'Reduces FOIT and CLS from font loading', confidence: 0.82,
        affectedPercent: badDisplayPct,
        codeExample: {
          before:   `@font-face { font-family: "${fontFamily}"; src: url("${fontUrl}"); }`,
          after:    `@font-face { font-family: "${fontFamily}"; src: url("${fontUrl}"); font-display: swap; }`,
          language: 'css',
        },
        learnMore: 'https://web.dev/articles/font-display',
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
      const userPrompt = buildFontPrompt(
        ctx.distributions.FCP,
        ctx.distributions.CLS,
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
