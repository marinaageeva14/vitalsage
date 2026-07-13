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
                `P75 INP is ${this.formatMs(inp.p75)}. Affected script(s): ` +
                `${thirdPartyHeadScripts.slice(0, 3).map(s => s.src ?? '(inline)').join(', ')}` +
                (thirdPartyHeadScripts.length > 3 ? ` and ${thirdPartyHeadScripts.length - 3} more.` : '.'),
        effort: 'medium', estimatedImpact: 'Reduces main-thread blocking time', confidence: 0.83,
        affectedSessions: affected,
        affectedPercent: affected / sessions.length,
        codeExample: {
          before:   `<script src="${thirdPartyHeadScripts[0]!.src ?? 'https://analytics.example.com/track.js'}"></script>`,
          after:    `<script src="${thirdPartyHeadScripts[0]!.src ?? 'https://analytics.example.com/track.js'}" defer></script>`,
          language: 'html',
        },
        learnMore: 'https://web.dev/articles/optimize-inp',
      }));
    }

    // Rule 3: Very poor INP — suggest profiling
    if (inp.p75 > 500) {
      // Use the measured attribution so this names the slow interaction, not
      // just the metric: which elements, which phase, what to fix.
      const phases  = aggregateINPAttribution(ctx.sessions);
      const targets = phases?.topTargets?.length
        ? `The slowest measured interaction target(s): ${phases.topTargets.slice(0, 3).map(t => t.target).join(', ')}. `
        : '';
      const phaseHint = phases
        ? (() => {
            const parts = [
              phases.inputDelay         !== undefined ? { name: 'input delay',         v: phases.inputDelay,         fix: 'the main thread is busy when the user interacts — break up the long tasks that run at load' } : null,
              phases.processingDuration !== undefined ? { name: 'handler processing',  v: phases.processingDuration, fix: 'the event handler itself is slow — profile and optimise it, or defer non-visual work with setTimeout' } : null,
              phases.presentationDelay  !== undefined ? { name: 'presentation delay',  v: phases.presentationDelay,  fix: 'rendering after the handler is slow — reduce the layout/paint cost the handler triggers' } : null,
            ].filter((p): p is NonNullable<typeof p> => p !== null);
            const dominant = parts.sort((a, b) => b.v - a.v)[0];
            return dominant ? `Dominant phase: ${dominant.name} (${Math.round(dominant.v)}ms) — ${dominant.fix}. ` : '';
          })()
        : '';
      suggestions.push(this.buildSuggestion({
        metric: 'INP', severity: 'critical',
        title:  `P75 INP of ${this.formatMs(inp.p75)} is "poor"${phases?.topTargets?.[0] ? ` — slowest interaction on ${phases.topTargets[0].target}` : ''}`,
        detail: `INP above 500ms is in the poor range. ` + targets + phaseHint +
                (targets || phaseHint
                  ? ''
                  : `Profile the page in Chrome DevTools → Performance panel to identify which event handlers run long tasks.`),
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
