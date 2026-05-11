import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildLCPPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAIResponse } from '../ai/parser.js';

export class LCPAgent extends BaseAgent {
  readonly name: AgentName = 'lcp';
  readonly relevantMetrics: MetricName[] = ['LCP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const lcp = ctx.distributions.LCP;
    if (!lcp) return { suggestions: [], skipped: true, skipReason: 'No LCP data' };

    const suggestions = [];
    const el = ctx.representativePage.lcpElement;
    const sessions = ctx.sessions;

    // Rule 1: Missing fetchpriority on LCP image
    if (el?.elementType === 'img' && !el.fetchPriority) {
      const affected = sessions.filter(s =>
        s.page.lcpElement?.elementType === 'img' && !s.page.lcpElement.fetchPriority
      ).length;
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'critical',
        title:  'LCP image missing fetchpriority="high"',
        detail: `Your LCP image lacks fetchpriority="high". In ${affected} of ${sessions.length} sessions ` +
                `(${this.formatPercent(affected / sessions.length)}) this delays the browser's fetch queue. ` +
                `P75 LCP is ${this.formatMs(lcp.p75)}. Adding fetchpriority typically saves 200–500ms.`,
        effort: 'low', estimatedImpact: '~200–500ms LCP reduction', confidence: 0.92,
        affectedSessions: affected,
        affectedPercent: affected / sessions.length,
        codeExample: {
          before:   `<img src="${el.src ?? '/hero.jpg'}">`,
          after:    `<img src="${el.src ?? '/hero.jpg'}" fetchpriority="high" width="..." height="...">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/fetch-priority',
      }));
    }

    // Rule 2: LCP image cross-origin with no preload
    if (el?.isThirdParty && !el.isPreloaded) {
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'critical',
        title:  'LCP image is cross-origin with no preload or preconnect',
        detail: `The LCP element (${el.src ?? 'unknown'}) is served from a third-party origin with no ` +
                `<link rel="preload"> or <link rel="preconnect">. A full round-trip DNS+TLS overhead is added. ` +
                `P75 LCP is ${this.formatMs(lcp.p75)}.`,
        effort: 'low', estimatedImpact: '~100–300ms LCP reduction', confidence: 0.88,
        codeExample: {
          before:   `<!-- No preload or preconnect -->`,
          after:    `<link rel="preconnect" href="${el.src ? new URL(el.src).origin : 'https://cdn.example.com'}">\n` +
                    `<link rel="preload" as="image" href="${el.src ?? '/hero.jpg'}" fetchpriority="high">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/optimize-lcp',
      }));
    }

    // Rule 3: Large mobile/desktop gap
    const mobileLCP  = lcp.byDevice['mobile']?.p75;
    const desktopLCP = lcp.byDevice['desktop']?.p75;
    if (mobileLCP && desktopLCP && mobileLCP > desktopLCP * 1.8) {
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'warning',
        title:  `Mobile LCP is ${Math.round(mobileLCP / desktopLCP)}× worse than desktop — likely non-responsive image`,
        detail: `Desktop p75 LCP: ${this.formatMs(desktopLCP)}. Mobile p75 LCP: ${this.formatMs(mobileLCP)}. ` +
                `A gap this large typically means the LCP image is not responsive — mobile devices download ` +
                `the same large image as desktop. Add srcset with mobile-sized variants.`,
        effort: 'medium', estimatedImpact: `~${this.formatMs(mobileLCP - desktopLCP)} mobile LCP reduction`,
        confidence: 0.78,
        codeExample: {
          before:   `<img src="/hero.jpg" fetchpriority="high">`,
          after:    `<img\n  srcset="/hero-480.jpg 480w, /hero-960.jpg 960w, /hero.jpg 1440w"\n  sizes="(max-width: 768px) 100vw, 50vw"\n  src="/hero.jpg"\n  fetchpriority="high">`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/serve-responsive-images',
      }));
    }

    // Rule 4: High TTFB masking LCP
    const ttfb = ctx.distributions.TTFB;
    if (ttfb && ttfb.rating === 'poor' && lcp.p75 > 4000) {
      suggestions.push(this.buildSuggestion({
        metric: 'LCP', severity: 'warning',
        title:  'High TTFB is masking LCP — fix server response time first',
        detail: `P75 TTFB is ${this.formatMs(ttfb.p75)} and P75 LCP is ${this.formatMs(lcp.p75)}. ` +
                `LCP cannot start until the server responds. Optimizing LCP-specific resources will have ` +
                `limited effect until TTFB is reduced below 800ms.`,
        effort: 'high', estimatedImpact: 'Unblocks full LCP optimization', confidence: 0.85,
        learnMore: 'https://web.dev/articles/ttfb',
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
      const userPrompt = buildLCPPrompt(
        ctx.distributions.LCP!,
        ctx.distributions.TTFB,
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

      const aiSuggestions = parseAIResponse(response.content, this.name, 'LCP');

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
