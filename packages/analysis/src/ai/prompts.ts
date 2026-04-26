import type { AgentName, MetricName } from '@vitalsage/types';
import type { MetricDistribution } from '@vitalsage/types';
import type { AnalysisConfidence } from '@vitalsage/types';
import type { PageContext, TraceMetrics } from '@vitalsage/types';

export const AI_SYSTEM_PROMPT = `
You are a senior web performance engineer analyzing real-user measurement (RUM) data
from a production website. You have access to Core Web Vitals distributions computed
from real user sessions.

Rules:
- Every suggestion must reference specific numbers from the data provided
- Do not give generic advice — "optimize images" is not acceptable
- Reference p75 values, affected session counts, and device breakdowns in your detail text
- Severity must match the data: p75 LCP > 4000ms = critical, 2500–4000ms = warning
- Format response ONLY as valid XML matching the schema provided
- Do not add any text before or after the XML
`.trim();

export const ANTHROPIC_OUTPUT_SCHEMA = `
<suggestions>
  <suggestion>
    <severity>critical|warning|info</severity>
    <title>One specific, actionable sentence referencing real values</title>
    <detail>2-4 sentences with specific numbers, affected session counts, and why this matters</detail>
    <effort>low|medium|high</effort>
    <impact>Specific estimated improvement e.g. "~200-400ms LCP reduction at p75"</impact>
    <confidence>0.0-1.0</confidence>
    <affectedPercent>0.0-1.0</affectedPercent>
    <beforeCode>optional code snippet</beforeCode>
    <afterCode>optional code snippet</afterCode>
    <codeLanguage>html|javascript|css|http|bash</codeLanguage>
    <learnMore>https://... (optional)</learnMore>
  </suggestion>
</suggestions>
`.trim();

/**
 * Output schema for the trace agent — extends the base schema with a <metric>
 * field so the AI can attribute each finding to the most-affected CWV.
 */
export const TRACE_OUTPUT_SCHEMA = `
<suggestions>
  <suggestion>
    <metric>LCP|FCP|CLS|INP|TTFB</metric>
    <severity>critical|warning|info</severity>
    <title>One specific, actionable sentence referencing real script/function names and ms values</title>
    <detail>2-4 sentences. Name the exact script or function causing the issue. Explain the causal chain from trace data to the CWV degradation.</detail>
    <effort>low|medium|high</effort>
    <impact>Specific estimated improvement referencing the trace values e.g. "~300ms LCP from splitting main.js"</impact>
    <confidence>0.0-1.0</confidence>
    <beforeCode>optional code snippet showing the problematic pattern</beforeCode>
    <afterCode>optional code snippet showing the fix</afterCode>
    <codeLanguage>html|javascript|css|http|bash</codeLanguage>
    <learnMore>https://... (optional)</learnMore>
  </suggestion>
</suggestions>
`.trim();

export function buildAgentUserPrompt(
  agentName:     AgentName,
  distributions: Partial<Record<MetricName, MetricDistribution>>,
  page:          PageContext,
  sampleSize:    number,
  confidence:    AnalysisConfidence,
): string {
  return `
## Analysis Context
- Sample size: ${sampleSize} sessions
- Confidence: ${confidence}
- Agent: ${agentName}

## Core Web Vitals Distributions (p50 / p75 / p95)
${formatDistributions(distributions)}

## Page Context (synthesized from sessions)
${formatPageContext(page)}

## Your task
Analyze the performance data above and generate 1-3 specific, actionable suggestions
for the ${agentName} domain. Focus on the highest-impact issues first.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

/**
 * Prompt for the trace agent — includes full trace metrics and cross-correlates
 * them with Core Web Vitals to produce root-cause analysis, not just threshold alerts.
 */
export function buildTraceUserPrompt(
  distributions: Partial<Record<MetricName, MetricDistribution>>,
  page:          PageContext,
  trace:         TraceMetrics,
  sampleSize:    number,
  confidence:    AnalysisConfidence,
): string {
  return `
## Analysis Context
- Sample size: ${sampleSize} sessions
- Confidence: ${confidence}
- Agent: trace (CPU / rendering profiler)

## Core Web Vitals Distributions (p50 / p75 / p95)
${formatDistributions(distributions)}

## Main Thread Breakdown (from CDP trace — same data as Chrome DevTools Performance tab)
- Total main-thread work: ${Math.round(trace.mainThreadWork)}ms
- JS execution (scripting): ${Math.round(trace.scriptingTime)}ms (${pct(trace.scriptingTime, trace.mainThreadWork)} of main thread)
- JS compile/parse: ${Math.round(trace.jsCompileTime)}ms (${pct(trace.jsCompileTime, trace.mainThreadWork)} of main thread)
- Style recalc + layout (rendering): ${Math.round(trace.renderingTime)}ms (${pct(trace.renderingTime, trace.mainThreadWork)} of main thread)
- Total Blocking Time: ${Math.round(trace.totalBlockingTime)}ms across ${trace.longTaskCount} long task(s)
- Forced layout count: ${trace.layoutCount}
- Style recalculation count: ${trace.styleRecalcCount}
- DOM nodes: ${trace.domNodes}
- JS event listeners: ${trace.jsListeners}
${trace.jsHeapUsed !== undefined ? `- JS heap: ${trace.jsHeapUsed}MB` : ''}

${trace.longTasks.length > 0 ? `## Top Long Tasks (blocking user input)\n${trace.longTasks.slice(0, 5).map(t =>
  `- ${Math.round(t.duration)}ms task at ${Math.round(t.startTime)}ms (blocking: ${Math.round(t.blocking)}ms)`
).join('\n')}` : ''}

${trace.topScripts && trace.topScripts.length > 0 ? `## JS Execution by Script (from EvaluateScript trace events)
${trace.topScripts.slice(0, 8).map(s =>
  `- ${s.url || '(inline/anonymous)'}: ${s.time}ms (${Math.round(s.share * 100)}%)`
).join('\n')}` : ''}

${trace.topFunctions && trace.topFunctions.length > 0 ? `## Top Functions by CPU Self Time (V8 profiler)
${trace.topFunctions.slice(0, 10).map(f =>
  `- ${f.functionName || '(anonymous)'} in ${f.url || '(unknown)'}:${f.lineNumber} — self: ${f.selfTime}ms, total: ${f.totalTime}ms`
).join('\n')}` : ''}

## Page Context
${formatPageContext(page)}

## Your task
You are analyzing CPU and rendering performance from a real CDP trace.
Cross-correlate the trace breakdown with the Core Web Vitals to identify the root cause:

1. Is the primary bottleneck scripting, rendering/layout, or network (low main-thread work but poor LCP)?
2. Which specific scripts or functions are the direct cause?
3. Are the long tasks caused by JS execution, layout thrashing, or something else?
4. Do the mobile/desktop CWV splits suggest this is a device-capability issue (high JS compile) or a network issue?

Generate 2-4 specific, root-cause suggestions. Avoid generic advice — reference the actual
script names, function names, and millisecond values from the trace data above.

${TRACE_OUTPUT_SCHEMA}
`.trim();
}

function formatDistributions(dists: Partial<Record<MetricName, MetricDistribution>>): string {
  return Object.entries(dists)
    .map(([name, d]) => {
      if (!d) return '';
      const base =
        `${name}: p50=${formatVal(name, d.p50)} / p75=${formatVal(name, d.p75)} / p95=${formatVal(name, d.p95)} [${d.rating}] (n=${d.sampleSize})`;
      const mobile  = d.byDevice.mobile  ? `\n  → Mobile p75: ${formatVal(name, d.byDevice.mobile.p75!)}` : '';
      const desktop = d.byDevice.desktop ? `\n  → Desktop p75: ${formatVal(name, d.byDevice.desktop.p75!)}` : '';
      return base + mobile + desktop;
    })
    .filter(Boolean)
    .join('\n');
}

function formatPageContext(page: PageContext): string {
  const lines: string[] = [
    `URL: ${page.url}`,
    `DOM nodes: ${page.domNodeCount}`,
    `Resources: ${page.resources.length}`,
    `Scripts: ${page.scripts.length} (${page.scripts.filter(s => s.isRenderBlocking).length} render-blocking)`,
    `Stylesheets: ${page.stylesheets.length} (${page.stylesheets.filter(s => s.isRenderBlocking).length} render-blocking)`,
    `Fonts: ${page.fonts.length} (${page.fonts.filter(f => !f.isSystemFont && !f.isIconFont).length} web fonts)`,
    `Images: ${page.images.length} (${page.images.filter(i => i.isAboveFold).length} above fold)`,
  ];

  if (page.lcpElement) {
    const el = page.lcpElement;
    lines.push(`LCP element: <${el.elementType}> ${el.src ?? ''} ${el.isPreloaded ? '[preloaded]' : '[not preloaded]'}`);
    if (el.naturalWidth && el.displayWidth) {
      lines.push(`  LCP size: natural=${el.naturalWidth}px display=${el.displayWidth}px`);
    }
  }

  const { redirectTime, dnsTime, tlsTime, serverTime, downloadTime } = page.navigationTiming;
  lines.push(`Navigation timing: redirect=${redirectTime}ms dns=${dnsTime}ms tls=${tlsTime}ms server=${serverTime}ms download=${downloadTime}ms`);

  return lines.join('\n');
}

function formatVal(name: string, v: number): string {
  return name === 'CLS' ? v.toFixed(3) : `${Math.round(v)}ms`;
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
