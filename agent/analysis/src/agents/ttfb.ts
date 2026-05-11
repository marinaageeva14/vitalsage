import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildTTFBPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAIResponse } from '../ai/parser.js';

export class TTFBAgent extends BaseAgent {
  readonly name: AgentName = 'ttfb';
  readonly relevantMetrics: MetricName[] = ['TTFB'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const ttfb = ctx.distributions.TTFB;
    if (!ttfb) return { suggestions: [], skipped: true, skipReason: 'No TTFB data' };

    const suggestions = [];
    const sessions = ctx.sessions;

    // Compute average navigation timing across sessions
    const timings = sessions.map(s => s.page.navigationTiming);
    const avg = (fn: (t: typeof timings[0]) => number) =>
      timings.reduce((sum, t) => sum + fn(t), 0) / (timings.length || 1);

    const avgServer    = avg(t => t.serverTime);
    const avgDns       = avg(t => t.dnsTime);
    const avgTls       = avg(t => t.tlsTime);
    const avgRedirects = avg(t => t.redirectTime);
    const avgWorker    = avg(t => t.workerTime);

    // Rule 1: High server response time
    if (avgServer > 600) {
      suggestions.push(this.buildSuggestion({
        metric: 'TTFB', severity: ttfb.p75 > 1800 ? 'critical' : 'warning',
        title:  `Server response time averages ${this.formatMs(avgServer)} — the dominant TTFB component`,
        detail: `P75 TTFB is ${this.formatMs(ttfb.p75)}. The server is taking an average of ` +
                `${this.formatMs(avgServer)} to start sending the first byte. Consider caching ` +
                `at the CDN edge, database query optimization, or server-side rendering with streaming.`,
        effort: 'high', estimatedImpact: 'Could reduce TTFB below 800ms threshold', confidence: 0.88,
        learnMore: 'https://web.dev/articles/ttfb',
      }));
    }

    // Rule 2: Redirects adding latency
    const redirectCount = avg(t => t.redirectCount);
    if (avgRedirects > 100 && redirectCount > 0) {
      suggestions.push(this.buildSuggestion({
        metric: 'TTFB', severity: 'warning',
        title:  `Redirects add ${this.formatMs(avgRedirects)} to TTFB on average`,
        detail: `Average redirect time is ${this.formatMs(avgRedirects)} with ${redirectCount.toFixed(1)} redirects per session. ` +
                `Each redirect is a full round trip. Update links and bookmarks to point directly to the ` +
                `canonical URL, and check for HTTP→HTTPS redirect chains.`,
        effort: 'low', estimatedImpact: `~${this.formatMs(avgRedirects)} TTFB reduction`, confidence: 0.85,
        learnMore: 'https://developer.chrome.com/docs/lighthouse/performance/redirects',
      }));
    }

    // Rule 3: Service Worker overhead
    const swSessions = sessions.filter(s => s.page.navigationTiming.isServiceWorker).length;
    if (avgWorker > 200 && swSessions > sessions.length * 0.2) {
      suggestions.push(this.buildSuggestion({
        metric: 'TTFB', severity: 'warning',
        title:  `Service Worker startup adds ${this.formatMs(avgWorker)} to TTFB in ${swSessions} sessions`,
        detail: `Service Worker activation takes an average of ${this.formatMs(avgWorker)} before the ` +
                `fetch handler runs. Ensure the Service Worker caches responses efficiently and consider ` +
                `using navigation preload to eliminate this overhead.`,
        effort: 'medium', estimatedImpact: `~${this.formatMs(avgWorker)} TTFB reduction on SW-served requests`,
        confidence: 0.8,
        affectedSessions: swSessions,
        affectedPercent: swSessions / sessions.length,
        learnMore: 'https://web.dev/articles/navigation-preload',
      }));
    }

    // Rule 4: High DNS lookup time (no preconnect to document origin)
    if (avgDns > 100) {
      suggestions.push(this.buildSuggestion({
        metric: 'TTFB', severity: 'info',
        title:  `DNS lookup averages ${this.formatMs(avgDns)} — consider DNS prefetch or provider upgrade`,
        detail: `Average DNS resolution is ${this.formatMs(avgDns)} ms. If the document origin is not ` +
                `cached by users' resolvers, DNS can add significant latency. Consider switching to a ` +
                `faster DNS provider or pre-caching DNS with dns-prefetch hints.`,
        effort: 'low', estimatedImpact: `~${this.formatMs(avgDns)} first-visit TTFB reduction`, confidence: 0.65,
        learnMore: 'https://developer.mozilla.org/en-US/docs/Web/Performance/dns-prefetch',
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
      const userPrompt = buildTTFBPrompt(
        ctx.distributions.TTFB!,
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

      const aiSuggestions = parseAIResponse(response.content, this.name, 'TTFB');

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
