import type { AgentContext, AgentName, MetricName } from '@vitalsage/types';
import { BaseAgent, type RuleBasedResult } from './base.js';

const TBT_CRITICAL  = 600;   // ms
const TBT_WARNING   = 300;   // ms
const LONG_TASK_CRITICAL = 10;
const LONG_TASK_WARNING  = 5;
const SCRIPTING_CRITICAL = 1500;  // ms
const SCRIPTING_WARNING  = 500;   // ms
const LAYOUT_CRITICAL    = 30;
const LAYOUT_WARNING     = 15;
const RECALC_WARNING     = 50;
const HEAP_WARNING_MB    = 100;

export class TraceAgent extends BaseAgent {
  readonly name: AgentName = 'trace';
  readonly relevantMetrics: MetricName[] = ['LCP', 'INP', 'FCP'];

  analyze(ctx: AgentContext): RuleBasedResult {
    const tm = ctx.representativePage.traceMetrics;
    if (!tm) return { suggestions: [], skipped: true, skipReason: 'No trace metrics — run with --capture-trace' };

    const suggestions = [];
    const lcp = ctx.distributions.LCP;
    const inp = ctx.distributions.INP;
    const fcp = ctx.distributions.FCP;

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
                (tm.longTasks[0] ? `Longest task: ${Math.round(tm.longTasks[0].duration)}ms at ${Math.round(tm.longTasks[0].startTime)}ms.` : ''),
        effort: 'medium', estimatedImpact: `~${Math.round(tm.totalBlockingTime * 0.6)}ms TBT reduction`, confidence: 0.88,
        codeExample: {
          before:   `// Synchronous heavy computation\nprocessData(largeArray);`,
          after:    `// Break into chunks using scheduler\nscheduler.postTask(() => processData(largeArray), { priority: 'background' });`,
          language: 'javascript',
        },
        learnMore: 'https://web.dev/articles/optimize-long-tasks',
      }));
    }

    // Rule 2: Excessive scripting time
    if (tm.scriptingTime >= SCRIPTING_WARNING) {
      const severity = tm.scriptingTime >= SCRIPTING_CRITICAL ? 'critical' : 'warning';
      const metric: MetricName = lcp?.rating === 'poor' ? 'LCP' : 'FCP';
      suggestions.push(this.buildSuggestion({
        metric, severity,
        title:  `JavaScript execution time is ${Math.round(tm.scriptingTime)}ms — exceeds recommended 300ms`,
        detail: `The browser spent ${Math.round(tm.scriptingTime)}ms executing JavaScript on the main thread. ` +
                `Heavy JS parse/compile/execute time is a common FCP/LCP blocker on mid-range devices. ` +
                `Consider code splitting, deferring non-critical scripts, and removing unused dependencies.`,
        effort: 'high', estimatedImpact: 'Up to 30–50% improvement on low-end devices', confidence: 0.82,
        codeExample: {
          before:   `import { heavyLib } from 'heavy-library';`,
          after:    `const heavyLib = await import('heavy-library'); // dynamic import`,
          language: 'javascript',
        },
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
                `"layout thrashing" — each read forces a full recalculation. Batch DOM reads before writes.`,
        effort: 'medium', estimatedImpact: 'Reduces main thread work and CLS', confidence: 0.79,
        codeExample: {
          before:   `// Read then write in a loop\nfor (const el of elements) {\n  el.style.width = el.offsetWidth + 10 + 'px';\n}`,
          after:    `// Batch reads first, then writes\nconst widths = elements.map(el => el.offsetWidth);\nelements.forEach((el, i) => el.style.width = widths[i] + 10 + 'px');`,
          language: 'javascript',
        },
        learnMore: 'https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing',
      }));
    }

    // Rule 4: Excessive style recalculations
    if (tm.styleRecalcCount >= RECALC_WARNING) {
      suggestions.push(this.buildSuggestion({
        metric: 'FCP', severity: 'warning',
        title:  `${tm.styleRecalcCount} style recalculations — complex CSS selector specificity`,
        detail: `${tm.styleRecalcCount} style recalculations indicates high CSS complexity. ` +
                `Overly specific selectors (e.g. div > ul > li > a) force the browser to recalculate ` +
                `styles frequently. Flatten your CSS and use BEM or utility classes to reduce recalc overhead.`,
        effort: 'medium', estimatedImpact: 'Reduces rendering time', confidence: 0.71,
        codeExample: {
          before:   `/* Deep selector — triggers full recalc */\n.page > .content > .list > .item > a { color: blue; }`,
          after:    `/* Flat class — faster style resolution */\n.nav-link { color: blue; }`,
          language: 'css',
        },
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

    return { suggestions, skipped: false };
  }

  // TraceAgent runs whenever trace data is present, regardless of metric ratings
  shouldRun(ctx: AgentContext): boolean {
    return ctx.representativePage.traceMetrics !== undefined;
  }
}
