import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult, type AIClient } from './base.js';
import { buildTraceUserPrompt, AI_SYSTEM_PROMPT } from '../ai/prompts.js';
import { parseAISuggestions } from '../ai/parser.js';

const TBT_CRITICAL  = 600;   // ms
const TBT_WARNING   = 300;   // ms
const SCRIPTING_CRITICAL = 1500;  // ms
const SCRIPTING_WARNING  = 500;   // ms
const LAYOUT_CRITICAL    = 30;
const LAYOUT_WARNING     = 15;
const RECALC_WARNING     = 50;
const HEAP_WARNING_MB    = 100;
// JS compile ratio: parse+compile > 40 % of scripting = bundle not code-split
const COMPILE_RATIO_WARNING = 0.40;
// DOM node thresholds.
// Lighthouse uses 800/1500 for its audit score, but those fire on almost every
// real-world site and produce noise. We use higher thresholds that indicate an
// actual measurable layout cost: warn at 2500, critical at 5000.
const DOM_NODES_WARNING  = 2500;
const DOM_NODES_CRITICAL = 5000;
// JS listeners: > 500 indicates likely memory leak or missing cleanup
const LISTENERS_WARNING = 500;
// Rendering-dominant: rendering > 60 % of main-thread work while scripting < 30 %
const RENDERING_DOMINANT_RATIO = 0.60;
const SCRIPTING_LOW_RATIO      = 0.30;

export class TraceAgent extends BaseAgent {
  readonly name: AgentName = 'trace';
  readonly relevantMetrics: MetricName[] = ['LCP', 'INP', 'FCP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const page = ctx.representativePage;
    const tm = page.traceMetrics;
    if (!tm) return { suggestions: [], skipped: true, skipReason: 'No trace metrics — run with --capture-trace' };

    const suggestions = [];
    const lcp = ctx.distributions.LCP;
    const inp = ctx.distributions.INP;
    const fcp = ctx.distributions.FCP;

    // Shared attribution strings — the measured scripts/functions most likely
    // responsible for main-thread cost, used to make several rules concrete.
    const topScript   = tm.topScripts?.[0];
    const topFn       = tm.topFunctions?.[0];
    const scriptsLine = tm.topScripts?.length
      ? tm.topScripts.slice(0, 3).map(s => `${s.url || '(inline)'} (${Math.round(s.time)}ms)`).join(', ')
      : '';

    // Rule 1: High Total Blocking Time
    if (tm.totalBlockingTime >= TBT_WARNING) {
      const severity = tm.totalBlockingTime >= TBT_CRITICAL ? 'critical' : 'warning';
      const metric: MetricName = inp?.rating === 'poor' || inp?.rating === 'needs-improvement' ? 'INP' : 'LCP';
      suggestions.push(this.buildSuggestion({
        metric, severity,
        title:  `Total Blocking Time is ${Math.round(tm.totalBlockingTime)}ms — main thread blocked by ${tm.longTaskCount} long task(s)`,
        detail: `${Math.round(tm.totalBlockingTime)}ms of main-thread work exceeds the 50ms task threshold ` +
                `across ${tm.longTaskCount} long task(s). The browser cannot respond to user input during these tasks, ` +
                `directly impacting INP and perceived responsiveness. ` +
                (tm.longTasks[0] ? `Longest task: ${Math.round(tm.longTasks[0].duration)}ms at ${Math.round(tm.longTasks[0].startTime)}ms. ` : '') +
                (scriptsLine ? `Scripts responsible for main-thread execution: ${scriptsLine}. ` : '') +
                (topFn ? `Hottest function: ${topFn.functionName || '(anonymous)'} in ${topFn.url}:${topFn.lineNumber} (${topFn.selfTime}ms self time). ` : '') +
                `Break these into <50ms chunks with scheduler.yield()/setTimeout, or move the work off the main thread.`,
        effort: 'medium', estimatedImpact: `~${Math.round(tm.totalBlockingTime * 0.6)}ms TBT reduction`, confidence: 0.88,
        ...(topScript?.url ? {
          codeExample: {
            before:   `<script src="${topScript.url}"></script> <!-- ${Math.round(topScript.time)}ms main-thread execution -->`,
            after:    `<script src="${topScript.url}" defer></script>\n<!-- or split it: -->\n<script>if (needed) import('${topScript.url}');</script>`,
            language: 'html' as const,
          },
        } : {}),
        learnMore: 'https://web.dev/articles/optimize-long-tasks',
      }));
    }

    // Rule 2: Excessive scripting time — with per-script attribution if available
    if (tm.scriptingTime >= SCRIPTING_WARNING) {
      const severity = tm.scriptingTime >= SCRIPTING_CRITICAL ? 'critical' : 'warning';
      const metric: MetricName = lcp?.rating === 'poor' ? 'LCP' : 'FCP';

      // Build a specific detail line when we have per-script breakdown from trace events.
      let scriptDetail = '';
      if (tm.topScripts && tm.topScripts.length > 0) {
        const top = tm.topScripts.slice(0, 3);
        const lines = top.map(s => {
          const label = s.url
            ? s.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || s.url
            : '(inline / anonymous)';
          return `${label} — ${Math.round(s.time)}ms (${Math.round(s.share * 100)}%)`;
        });
        scriptDetail = ` Top scripts by execution time:\n${lines.map(l => `  • ${l}`).join('\n')}`;
      }

      suggestions.push(this.buildSuggestion({
        metric, severity,
        title:  `JavaScript execution time is ${Math.round(tm.scriptingTime)}ms — exceeds recommended 300ms`,
        detail: `The browser spent ${Math.round(tm.scriptingTime)}ms executing JavaScript on the main thread. ` +
                `Heavy JS parse/compile/execute time is a common FCP/LCP blocker on mid-range devices. ` +
                `Consider code splitting, deferring non-critical scripts, and removing unused dependencies.` +
                scriptDetail,
        effort: 'high', estimatedImpact: 'Up to 30–50% improvement on low-end devices', confidence: 0.82,
        learnMore: 'https://web.dev/articles/bootup-time',
      }));
    }

    // Rule 3: Layout thrashing (excessive layout/reflow count)
    if (tm.layoutCount >= LAYOUT_WARNING) {
      const severity = tm.layoutCount >= LAYOUT_CRITICAL ? 'critical' : 'warning';
      suggestions.push(this.buildSuggestion({
        metric: 'CLS', severity,
        title:  `${tm.layoutCount} forced layout(s) detected — likely layout thrashing`,
        detail: `The browser performed ${tm.layoutCount} layout calculations during page load. ` +
                `Forced synchronous layouts (reading layout properties after DOM mutations) cause ` +
                `"layout thrashing" — each read forces a full recalculation. Batch DOM reads before writes. ` +
                (scriptsLine
                  ? `The scripts doing the main-thread work — and therefore the most likely writers: ${scriptsLine}. `
                  : '') +
                (topFn
                  ? `Start the search at ${topFn.functionName || '(anonymous)'} in ${topFn.url}:${topFn.lineNumber} — it holds the most CPU time (${topFn.selfTime}ms).`
                  : ''),
        effort: 'medium', estimatedImpact: 'Reduces main thread work and CLS', confidence: 0.79,
        learnMore: 'https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing',
      }));
    }

    // Rule 4: Excessive style recalculations
    if (tm.styleRecalcCount >= RECALC_WARNING) {
      const blockingSheets = page.stylesheets
        .filter(s => s.isRenderBlocking && s.href)
        .sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0));
      const sheetsLine = blockingSheets.slice(0, 3)
        .map(s => `${s.href}${s.transferSize ? ` (${Math.round(s.transferSize / 1024)}KB)` : ''}`)
        .join(', ');
      const biggest = blockingSheets[0];
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'warning',
        title:  `${tm.styleRecalcCount} style recalculations — complex CSS selector specificity`,
        detail: `${tm.styleRecalcCount} style recalculations indicates high CSS complexity across a ` +
                `${tm.domNodes.toLocaleString()}-node DOM — each recalc has to match selectors against the whole tree. ` +
                (sheetsLine ? `The stylesheets to audit, largest first: ${sheetsLine}. ` : '') +
                `Record a DevTools Performance profile and open "Recalculate Style" events to see which ` +
                `selectors are slow; flatten those instead of rewriting all CSS.`,
        effort: 'medium', estimatedImpact: 'Reduces rendering time', confidence: 0.71,
        ...(biggest?.href ? {
          codeExample: {
            before:   `<link rel="stylesheet" href="${biggest.href}">${biggest.transferSize ? ` <!-- ${Math.round(biggest.transferSize / 1024)}KB, render-blocking -->` : ''}`,
            after:    `<style>/* critical above-fold rules extracted from ${biggest.href.split('/').pop()} */</style>\n<link rel="stylesheet" href="${biggest.href}" media="print" onload="this.media='all'">`,
            language: 'html' as const,
          },
        } : {}),
        learnMore: 'https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations',
      }));
    }

    // Rule 5: High JS heap size
    if (tm.jsHeapUsed !== undefined && tm.jsHeapUsed >= HEAP_WARNING_MB) {
      suggestions.push(this.buildSuggestion({
        metric: 'INP', severity: 'warning',
        title:  `JS heap is ${tm.jsHeapUsed}MB — high memory pressure slows garbage collection`,
        detail: `A ${tm.jsHeapUsed}MB JavaScript heap causes frequent GC pauses that manifest as ` +
                `input lag and jank. Common causes: memory leaks, large caches, retained closures, ` +
                `or not cleaning up event listeners on component unmount.`,
        effort: 'high', estimatedImpact: 'Reduces GC-related jank', confidence: 0.74,
        learnMore: 'https://web.dev/articles/memory-problems',
      }));
    }

    // Rule 6: Hot functions from CPU profiler (only when --full-report trace was captured)
    // Flag any single function consuming > 10 % of total self time as a bottleneck.
    if (tm.topFunctions && tm.topFunctions.length > 0) {
      const totalSelfTime = tm.topFunctions.reduce((s, f) => s + f.selfTime, 0);
      const HOTSPOT_THRESHOLD = 0.10;   // > 10 % self time = bottleneck

      for (const fn of tm.topFunctions.slice(0, 10)) {
        const share = totalSelfTime > 0 ? fn.selfTime / totalSelfTime : 0;
        if (share < HOTSPOT_THRESHOLD || fn.selfTime < 50) continue;

        const label   = fn.url
          ? `${fn.functionName || '(anonymous)'} in ${fn.url.replace(/^https?:\/\/[^/]+/, '') || fn.url}:${fn.lineNumber}`
          : fn.functionName || '(anonymous)';
        const pctStr  = `${Math.round(share * 100)}%`;

        suggestions.push(this.buildSuggestion({
          metric: inp?.rating === 'poor' ? 'INP' as MetricName : 'LCP' as MetricName,
          severity: share >= 0.25 ? 'critical' : 'warning',
          title:  `Hot function: ${fn.functionName || '(anonymous)'} — ${pctStr} of CPU self time (${fn.selfTime}ms)`,
          detail: `${label} accounts for ${pctStr} of measured JavaScript self time ` +
                  `(${fn.selfTime}ms self / ${fn.totalTime}ms total, ${fn.sampleCount} profiler samples). ` +
                  `This function is a primary bottleneck. Profile with DevTools CPU profiler for a full call tree, ` +
                  `then consider memoisation, moving work off the main thread (Web Worker), or algorithmic optimisation.`,
          effort: 'high',
          estimatedImpact: `Up to ${Math.round(fn.selfTime * 0.7)}ms reduction if optimised`,
          confidence: 0.85,
          learnMore: 'https://web.dev/articles/optimize-long-tasks',
        }));
      }
    }

    // Rule 7: High JS compile ratio — bundle is not code-split / not cached
    // If parse+compile time is > 40 % of scripting time, the cold-parse cost is
    // dominant. Typical cause: large monolithic bundle, no module splitting, or
    // cache busting on every deploy.
    if (
      tm.scriptingTime >= SCRIPTING_WARNING &&
      tm.jsCompileTime > 0 &&
      tm.jsCompileTime / tm.scriptingTime >= COMPILE_RATIO_WARNING
    ) {
      const ratio = Math.round((tm.jsCompileTime / tm.scriptingTime) * 100);
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'warning',
        title:  `JS parse/compile is ${ratio}% of scripting time (${Math.round(tm.jsCompileTime)}ms) — bundle is too large to parse quickly`,
        detail: `${Math.round(tm.jsCompileTime)}ms of the ${Math.round(tm.scriptingTime)}ms scripting cost is V8 parse and compile, ` +
                `not execution. This cost is paid on every cold load and on low-end devices it multiplies 3–5×. ` +
                `Split the bundle by route, move heavy modules behind dynamic imports, and verify HTTP caching headers ` +
                `(Cache-Control: immutable) so the parsed bytecode is reused across sessions.`,
        effort: 'high', estimatedImpact: `~${Math.round(tm.jsCompileTime * 0.6)}ms FCP improvement on cold loads`, confidence: 0.84,
        learnMore: 'https://web.dev/articles/reduce-javascript-payloads-with-code-splitting',
      }));
    }

    // Rule 8: High DOM node count
    // Every layout and style recalc is O(n) in DOM size. Lighthouse warns at 800,
    // flags critical at 1500. Large DOMs also inflate JS heap (detached DOM nodes).
    if (tm.domNodes >= DOM_NODES_WARNING) {
      const severity = tm.domNodes >= DOM_NODES_CRITICAL ? 'critical' : 'warning';
      const ds       = page.domStats;
      const widest   = ds?.widestElements?.[0];
      const hotspots = ds?.widestElements?.length
        ? `The widest elements — the virtualisation candidates: ${ds.widestElements.slice(0, 3).map(w => `${w.selector} (${w.childCount} direct children)`).join(', ')}. `
        : '';
      const depth    = ds?.deepestElement
        ? `Deepest nesting: ${ds.maxDepth} levels at ${ds.deepestElement}. `
        : '';
      suggestions.push(this.buildSuggestion({
        metric: 'CLS', severity,
        title:  `DOM has ${tm.domNodes.toLocaleString()} nodes — exceeds the ${DOM_NODES_CRITICAL} recommended limit`,
        detail: `A DOM of ${tm.domNodes.toLocaleString()} nodes makes every layout recalculation and style update slower. ` +
                `Each forced layout (of which there are ${tm.layoutCount}) must traverse the entire tree. ` +
                hotspots + depth +
                `Virtualise the wide lists (render only visible rows), remove off-screen/hidden elements, ` +
                `and defer rendering of below-the-fold content.`,
        effort: 'medium', estimatedImpact: 'Reduces layout and style recalc time proportionally', confidence: 0.80,
        ...(widest ? {
          codeExample: {
            before:   `<!-- ${widest.selector} renders all ${widest.childCount} children at once -->\n<${widest.selector.split(/[#.]/)[0]}> …${widest.childCount} children… </${widest.selector.split(/[#.]/)[0]}>`,
            after:    `<!-- render only the visible window (react-window, virtua, content-visibility) -->\n<${widest.selector.split(/[#.]/)[0]} style="content-visibility: auto; contain-intrinsic-size: auto 500px"> …visible rows only… </${widest.selector.split(/[#.]/)[0]}>`,
            language: 'html' as const,
          },
        } : {}),
        learnMore: 'https://developer.chrome.com/docs/lighthouse/performance/dom-size',
      }));
    }

    // Rule 9: JS event listener bloat
    // > 500 listeners is unusual and typically means listeners are being added
    // without corresponding removeEventListener on teardown — a memory leak pattern
    // that accumulates across SPA navigations and causes GC jank.
    if (tm.jsListeners >= LISTENERS_WARNING) {
      const ls = page.listenerStats;
      const byType = ls?.byType?.length
        ? `Measured breakdown by event type: ${ls.byType.slice(0, 5).map(t => `${t.type}: ${t.count}`).join(', ')}. `
        : '';
      const byTarget = ls?.topTargets?.length
        ? `Elements holding the most listeners: ${ls.topTargets.slice(0, 3).map(t => `${t.target} (${t.count})`).join(', ')}. `
        : '';
      const topType   = ls?.byType?.[0];
      const topTarget = ls?.topTargets?.[0];
      suggestions.push(this.buildSuggestion({
        metric: 'INP', severity: 'warning',
        title:  `${tm.jsListeners} active JS event listeners — possible listener leak`,
        detail: `${tm.jsListeners} registered event listeners is unusually high for a single page. ` +
                byType + byTarget +
                `Listeners added in React useEffect or component mount without cleanup accumulate across ` +
                `navigation, and each retains its closure scope in memory. ` +
                (topType && topTarget
                  ? `Replace the per-element '${topType.type}' handlers with one delegated listener on a stable ancestor.`
                  : `Audit with Chrome DevTools → Memory → Event Listeners panel.`),
        effort: 'medium', estimatedImpact: 'Reduces memory pressure and GC pauses', confidence: 0.72,
        ...(topType && topTarget ? {
          codeExample: {
            before:   `// ${topType.count} separate '${topType.type}' listeners (most on ${topTarget.target})\nitems.forEach(el => el.addEventListener('${topType.type}', onEvent));`,
            after:    `// one delegated listener replaces them\ndocument.querySelector('${topTarget.target.replace(/^(window|document)$/, 'body')}').addEventListener('${topType.type}', e => {\n  const item = e.target.closest('[data-item]');\n  if (item) onEvent(e, item);\n});`,
            language: 'javascript' as const,
          },
        } : {}),
        learnMore: 'https://web.dev/articles/memory-problems',
      }));
    }

    // Rule 10: Rendering-dominant profile
    // If rendering (style recalc + layout) is the dominant main-thread cost and
    // scripting is low, the problem is CSS/animation, not JavaScript bundle size.
    // Common cause: CSS animations using non-composited properties (top/left/width),
    // wildcard selectors, or heavy visual effects (box-shadow, filter).
    const mainWork = tm.mainThreadWork;
    if (
      mainWork > 200 &&
      tm.renderingTime / mainWork >= RENDERING_DOMINANT_RATIO &&
      tm.scriptingTime / mainWork < SCRIPTING_LOW_RATIO
    ) {
      const renderPct = Math.round((tm.renderingTime / mainWork) * 100);
      const biggestSheet = page.stylesheets
        .filter(s => s.isRenderBlocking && s.href)
        .sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0))[0];
      suggestions.push(this.buildSuggestion({
        metric: 'CLS', severity: 'warning',
        title:  `Rendering is ${renderPct}% of main-thread work — CSS/layout is the bottleneck, not JavaScript`,
        detail: `Style recalc (${Math.round(tm.renderingTime)}ms) dominates the main thread while scripting is only ` +
                `${Math.round(tm.scriptingTime)}ms. This pattern means CSS complexity is the primary performance cost, ` +
                `not bundle size. ` +
                (biggestSheet?.href ? `Start with the largest stylesheet: ${biggestSheet.href}${biggestSheet.transferSize ? ` (${Math.round(biggestSheet.transferSize / 1024)}KB)` : ''}. ` : '') +
                `Use transform/opacity for animations (compositor-threaded), flatten CSS selectors, ` +
                `and add will-change: transform to elements that animate to promote them to their own compositor layer.`,
        effort: 'medium', estimatedImpact: 'Moves rendering off the main thread', confidence: 0.77,
        learnMore: 'https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count',
      }));
    }

    return { suggestions, skipped: false };
  }

  /**
   * AI enhancement for trace analysis.
   *
   * Other agents pass generic page context to AI. The trace agent instead sends
   * the full trace breakdown — scripting time, compile ratio, long tasks, hot
   * scripts, hot functions — so the AI can cross-correlate CPU data with CWV and
   * give root-cause answers rather than generic threshold alerts.
   */
  async enhance(
    result:  RuleBasedResult,
    ctx:     AgentContext,
    ai:      AIClient | null,
  ): Promise<RuleBasedResult> {
    const tm = ctx.representativePage.traceMetrics;
    if (!ai || !tm) return result;

    try {
      // Include the lab conditions so the model can judge whether the numbers
      // are expected under throttling or genuinely alarming.
      const sim = ctx.sessions.find(s => s.device.simulated)?.device.simulated;
      const runProfile = sim ? `${sim.networkProfile} network · ${sim.viewportProfile} viewport (throttled lab run)` : undefined;

      const userPrompt = buildTraceUserPrompt(
        ctx.distributions,
        ctx.representativePage,
        tm,
        ctx.sampleSize,
        ctx.confidence,
        runProfile,
      );

      const response = await ai.complete({
        systemPrompt: AI_SYSTEM_PROMPT,
        userPrompt,
        temperature:  0.2,   // low temperature for analytical tasks
        maxTokens:    1200,
      });

      const aiSuggestions = parseAISuggestions(response.content, this.name, 'LCP', userPrompt);

      // Merge: keep rule-based suggestions that the AI didn't duplicate,
      // then append AI suggestions. AI suggestions are appended after rules
      // because rules have higher precision on known thresholds.
      const aiTitlesNorm = new Set(
        aiSuggestions.map(s => s.title.toLowerCase().slice(0, 40))
      );
      const dedupedRules = result.suggestions.filter(
        s => !aiTitlesNorm.has(s.title.toLowerCase().slice(0, 40))
      );

      return { ...result, suggestions: [...dedupedRules, ...aiSuggestions] };
    } catch {
      // AI failure is non-fatal — fall back to rule-based suggestions
      return result;
    }
  }

  // TraceAgent runs whenever trace data is present, regardless of metric ratings
  shouldRun(ctx: AgentContext): boolean {
    return ctx.representativePage.traceMetrics !== undefined;
  }
}
