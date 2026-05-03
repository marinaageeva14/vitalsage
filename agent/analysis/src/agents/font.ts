import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult } from './base.js';

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
                `be displayed. P75 FCP is ${this.formatMs(fcp.p75)}.`,
        effort: 'low', estimatedImpact: '~100–300ms FCP improvement', confidence: 0.84,
        codeExample: {
          before:   `<!-- Font discovered when CSS is parsed -->`,
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
                `discovered late. This is a common misconfiguration.`,
        effort: 'low', estimatedImpact: 'Activates existing preload hints', confidence: 0.97,
        codeExample: {
          before:   `<link rel="preload" as="font" href="/font.woff2">`,
          after:    `<link rel="preload" as="font" href="/font.woff2" crossorigin>`,
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
      const metric = cls?.rating === 'poor' || cls?.rating === 'needs-improvement' ? 'CLS' : 'FCP';
      suggestions.push(this.buildSuggestion({
        metric: metric as MetricName, severity: 'warning',
        title:  `${this.formatPercent(badDisplayPct)} of sessions have fonts without font-display:swap`,
        detail: `Fonts using font-display:auto or block hide text until the font loads (FOIT), ` +
                `then cause a relayout when the font becomes available — a direct CLS source. ` +
                `Use font-display:swap for body text or font-display:optional for decorative fonts.`,
        effort: 'low', estimatedImpact: 'Reduces FOIT and CLS from font loading', confidence: 0.82,
        affectedPercent: badDisplayPct,
        codeExample: {
          before:   `@font-face { font-family: "MyFont"; src: url("/font.woff2"); }`,
          after:    `@font-face { font-family: "MyFont"; src: url("/font.woff2"); font-display: swap; }`,
          language: 'css',
        },
        learnMore: 'https://web.dev/articles/font-display',
      }));
    }

    return { suggestions, skipped: false };
  }
}
