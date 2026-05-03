import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult } from './base.js';

export class ResourceHintAgent extends BaseAgent {
  readonly name: AgentName = 'resource-hint';
  readonly relevantMetrics: MetricName[] = ['LCP', 'FCP', 'TTFB'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const lcp = ctx.distributions.LCP;
    if (!lcp) return { suggestions: [], skipped: true, skipReason: 'No LCP data' };

    const suggestions = [];
    const page = ctx.representativePage;

    // Rule 1: LCP image not preloaded
    const lcpEl = page.lcpElement;
    if (lcpEl?.elementType === 'img' && !lcpEl.isPreloaded) {
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'critical',
        title:  'LCP image is not preloaded — browser discovers it late',
        detail: `The LCP image (${lcpEl.src ?? 'unknown'}) is not preloaded. The browser only ` +
                `discovers it when the parser reaches the <img> tag, adding at least one extra render-blocking ` +
                `delay. A <link rel="preload"> in <head> moves the fetch into the preload scanner. ` +
                `P75 LCP is ${this.formatMs(lcp.p75)}.`,
        effort: 'low', estimatedImpact: '~100–500ms LCP reduction', confidence: 0.89,
        codeExample: {
          before:   `<!-- No preload -->`,
          after:    `<link rel="preload" as="image" href="${lcpEl.src ?? '/hero.jpg'}" fetchpriority="high">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/preload-critical-assets',
      }));
    }

    // Rule 2: Third-party origins loaded early without preconnect
    const pageOrigin = (() => {
      try { return new URL(page.url).origin; } catch { return ''; }
    })();
    const thirdPartyOrigins = new Set(
      page.resources
        .filter(r => {
          try { return new URL(r.name).origin !== pageOrigin; } catch { return false; }
        })
        .map(r => { try { return new URL(r.name).origin; } catch { return ''; } })
        .filter(Boolean)
    );
    if (thirdPartyOrigins.size > 0 && thirdPartyOrigins.size <= 6) {
      const origins = [...thirdPartyOrigins].slice(0, 3);
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'warning',
        title:  `${thirdPartyOrigins.size} third-party origin(s) loaded without preconnect`,
        detail: `Found ${thirdPartyOrigins.size} third-party origins (e.g. ${origins.join(', ')}) ` +
                `that could benefit from <link rel="preconnect">. Each origin requires DNS lookup + ` +
                `TCP handshake + TLS negotiation before the first byte can be received.`,
        effort: 'low', estimatedImpact: '~50–200ms per origin', confidence: 0.72,
        codeExample: {
          before:   `<!-- No preconnect -->`,
          after:    origins.map(o => `<link rel="preconnect" href="${o}">`).join('\n'),
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/preconnect-and-dns-prefetch',
      }));
    }

    // Rule 3: Too many preconnects (> 6 origins — diminishing returns)
    if (thirdPartyOrigins.size > 6) {
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'info',
        title:  `${thirdPartyOrigins.size} third-party origins — audit for unnecessary third-parties`,
        detail: `More than 6 third-party origins is a sign of excessive third-party dependency. ` +
                `Each origin adds DNS+TCP+TLS overhead. Preconnect only to the 2–3 most critical origins; ` +
                `for the rest, audit whether they are necessary.`,
        effort: 'high', estimatedImpact: 'Variable — depends on third-party audit', confidence: 0.65,
        learnMore: 'https://web.dev/articles/third-party-summary',
      }));
    }

    return { suggestions, skipped: false };
  }
}
