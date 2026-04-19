import type { AgentName, MetricName } from '@vitalsage/types';
import type { MetricDistribution } from '@vitalsage/types';
import type { AnalysisConfidence } from '@vitalsage/types';
import type { PageContext } from '@vitalsage/types';

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
