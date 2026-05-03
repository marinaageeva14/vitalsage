import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult } from './base.js';

export class ImageAgent extends BaseAgent {
  readonly name: AgentName = 'image';
  readonly relevantMetrics: MetricName[] = ['LCP', 'FCP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const lcp = ctx.distributions.LCP;
    const fcp = ctx.distributions.FCP;
    if (!lcp && !fcp) return { suggestions: [], skipped: true, skipReason: 'No LCP or FCP data' };

    const suggestions = [];
    const sessions = ctx.sessions;
    const page = ctx.representativePage;

    // Rule 1: LCP image in legacy format (PNG/JPEG)
    const lcpEl = page.lcpElement;
    const lcpImg = page.images.find(i => i.isLCP);
    if (lcpImg?.format && ['png', 'jpeg', 'jpg'].includes(lcpImg.format.toLowerCase())) {
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'warning',
        title:  `LCP image is ${lcpImg.format.toUpperCase()} — convert to WebP/AVIF for 25–50% size reduction`,
        detail: `The LCP image uses ${lcpImg.format.toUpperCase()} format. WebP provides 25–34% smaller files ` +
                `than JPEG at equivalent quality; AVIF provides up to 50% reduction. ` +
                `Serve modern formats using <picture> with fallback.`,
        effort: 'medium', estimatedImpact: '25–50% LCP image transfer reduction', confidence: 0.85,
        codeExample: {
          before:   `<img src="/hero.jpg" fetchpriority="high">`,
          after:    `<picture>\n  <source srcset="/hero.avif" type="image/avif">\n  <source srcset="/hero.webp" type="image/webp">\n  <img src="/hero.jpg" fetchpriority="high">\n</picture>`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/choose-the-right-image-format',
      }));
    }

    // Rule 2: LCP image oversize (naturalWidth >> displayWidth)
    if (lcpEl && lcpEl.naturalWidth && lcpEl.displayWidth && lcpEl.naturalWidth > lcpEl.displayWidth * 1.5) {
      const oversizePct = sessions.filter(s => {
        const el = s.page.lcpElement;
        return el?.naturalWidth && el.displayWidth && el.naturalWidth > el.displayWidth * 1.5;
      }).length / sessions.length;
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'warning',
        title:  `LCP image is ${Math.round(lcpEl.naturalWidth / lcpEl.displayWidth)}× oversized — add srcset variants`,
        detail: `The LCP image's natural size (${lcpEl.naturalWidth}px) is much larger than its display size ` +
                `(${lcpEl.displayWidth}px) in ${this.formatPercent(oversizePct)} of sessions. ` +
                `Serving the correctly-sized image would reduce transfer size proportionally.`,
        effort: 'medium', estimatedImpact: `~${Math.round((1 - lcpEl.displayWidth / lcpEl.naturalWidth) * 100)}% LCP image size reduction`,
        confidence: 0.87,
        affectedPercent: oversizePct,
        learnMore: 'https://web.dev/articles/uses-responsive-images',
      }));
    }

    // Rule 3: Above-fold images with loading="lazy"
    const lazyAboveFoldPct = this.pctBad(sessions, s =>
      s.page.images.some(img => img.isAboveFold && img.loading === 'lazy')
    );
    if (lazyAboveFoldPct > 0.2) {
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'critical',
        title:  `Above-fold images with loading="lazy" delay LCP in ${this.formatPercent(lazyAboveFoldPct)} of sessions`,
        detail: `Images with loading="lazy" are not fetched until the browser determines they're in the ` +
                `viewport — but it can only do this after layout is complete. Applying lazy loading to ` +
                `above-fold images, especially the LCP image, directly delays the LCP metric.`,
        effort: 'low', estimatedImpact: 'Direct LCP improvement', confidence: 0.93,
        affectedPercent: lazyAboveFoldPct,
        codeExample: {
          before:   `<img src="/hero.jpg" loading="lazy">`,
          after:    `<img src="/hero.jpg" fetchpriority="high">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/browser-level-image-lazy-loading',
      }));
    }

    return { suggestions, skipped: false };
  }
}
