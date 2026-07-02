import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildINPPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAIResponse } from '../ai/parser.js';
import { aggregateINPAttribution } from '../aggregator/attribution.js';

export class INPAgent extends BaseAgent {
  readonly name: AgentName = 'inp';
  readonly relevantMetrics: MetricName[] = ['INP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const inp = ctx.distributions.INP;
    if (!inp) return { suggestions: [], skipped: true, skipReason: 'No INP data' };

    const suggestions = [];
    const sessions = ctx.sessions;

    // Rule 1: Mobile/desktop INP gap
    const mobileINP  = inp.byDevice['mobile']?.p75;
    const desktopINP = inp.byDevice['desktop']?.p75;
    if (mobileINP && desktopINP && mobileINP > desktopINP * 1.5) {
      suggestions.push(this.buildSuggestion({
        metric: 'INP', severity: 'warning',
        title:  `Mobile INP (${this.formatMs(mobileINP)}) is significantly worse than desktop (${this.formatMs(desktopINP)})`,
        detail: `Mobile devices have less CPU power, so long tasks hit them harder. ` +
                `Reduce JavaScript execution time on the main thread and break long tasks into smaller chunks ` +
                `using scheduler.postTask() or setTimeout(0).`,
        effort: 'high', estimatedImpact: `~${this.formatMs(mobileINP - desktopINP)} mobile INP reduction`,
        confidence: 0.78,
        learnMore: 'https://web.dev/articles/inp',
      }));
    }

    // Rule 2: Render-blocking or large third-party scripts in head
    const thirdPartyHeadScripts = ctx.representativePage.scripts.filter(
      s => s.isThirdParty && s.position === 'head' && !s.isDeferred && !s.isAsync
    );
    if (thirdPartyHeadScripts.length > 0) {
      const affected = sessions.filter(s =>
        s.page.scripts.some(sc => sc.isThirdParty && sc.position === 'head' && !sc.isDeferred && !sc.isAsync)
      ).length;
      suggestions.push(this.buildSuggestion({
        metric: 'INP', severity: inp.p75 > 500 ? 'critical' : 'warning',
        title:  `${thirdPartyHeadScripts.length} synchronous third-party script(s) in <head> block interaction readiness`,
        detail: `Found ${thirdPartyHeadScripts.length} third-party synchronous script(s) in <head>, ` +
                `blocking the main thread before users can interact. Affects ${affected} of ${sessions.length} sessions. ` +
                `P75 INP is ${this.formatMs(inp.p75)}.`,
        effort: 'medium', estimatedImpact: 'Reduces main-thread blocking time', confidence: 0.83,
        affectedSessions: affected,
        affectedPercent: affected / sessions.length,
        codeExample: {
          before:   `<script src="https://analytics.example.com/track.js"></script>`,
          after:    `<script src="https://analytics.example.com/track.js" defer></script>`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/optimize-inp',
      }));
    }

    // Rule 3: Very poor INP — suggest profiling
    if (inp.p75 > 500) {
      suggestions.push(this.buildSuggestion({
        metric: 'INP', severity: 'critical',
        title:  `P75 INP of ${this.formatMs(inp.p75)} is "poor" — profile with Chrome DevTools to find long tasks`,
        detail: `INP above 500ms is in the poor range. The most effective next step is to profile your ` +
                `page in Chrome DevTools → Performance panel to identify which event handlers are running ` +
                `long tasks. Look for forced layout/reflow patterns.`,
        effort: 'high', estimatedImpact: 'Depends on root cause', confidence: 0.7,
        learnMore: 'https://web.dev/articles/diagnose-slow-interactions-in-the-lab',
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
      const userPrompt = buildINPPrompt(
        ctx.distributions.INP!,
        ctx.representativePage,
        ctx.sampleSize,
        ctx.confidence,
        result.suggestions,
        aggregateINPAttribution(ctx.sessions),
      );

      const response = await ai.complete({
        systemPrompt: AI_SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.2,
        maxTokens:   1000,
      });

      const aiSuggestions = parseAIResponse(response.content, this.name, 'INP', userPrompt);

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
