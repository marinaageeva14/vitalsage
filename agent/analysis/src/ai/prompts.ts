/**
 * AI prompt builders — one per agent.
 *
 * Each function sends ONLY the data relevant to that agent's domain and gives
 * the AI specific instructions that go beyond what the rule-based layer already
 * checks. The rule-based suggestions are passed in so the AI doesn't repeat
 * threshold alerts the rules already surfaced — it finds things the rules miss.
 */
import type { MetricDistribution, PageContext, TraceMetrics, Suggestion } from '@vitalsage/types';
import type { LCPPhaseSummary, INPPhaseSummary, CLSSourceSummary } from '../aggregator/attribution.js';

// ─── Shared types ────────────────────────────────────────────────────────────

export const AI_SYSTEM_PROMPT = `
You are a senior web performance engineer analyzing web performance measurement
data — Core Web Vitals distributions and page context from real-user sessions,
synthetic lab runs, or both. The data source is stated in each request; never
describe synthetic lab data as real-user behaviour.

Rules:
- Every suggestion must reference specific numbers from the data provided.
  Never introduce a number that does not appear in the request.
- Do not repeat findings that are already listed in "Rule-based findings" — add new insights
- Do not give generic advice — "optimize images" is not acceptable
- Reference p75 values, affected session counts, and device breakdowns in your detail text
- Severity must match the data (p75): LCP >4000ms = critical, 2500–4000ms = warning;
  INP >500ms = critical, 200–500ms = warning; CLS >0.25 = critical, 0.1–0.25 = warning;
  TTFB >1800ms = critical, 800–1800ms = warning; FCP >3000ms = critical, 1800–3000ms = warning
- If the sample size is below 20 sessions or confidence is "low", cap severity at
  "warning" and state the uncertainty in the detail text
- If the data does not clearly support any additional finding, return an empty
  <suggestions/> element. A truthful empty answer is strictly better than a
  speculative one — you are never required to invent findings.
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
    <beforeCode><![CDATA[optional code snippet]]></beforeCode>
    <afterCode><![CDATA[optional code snippet]]></afterCode>
    <codeLanguage>html|javascript|css|http|bash</codeLanguage>
    <learnMore>https://... (optional)</learnMore>
  </suggestion>
</suggestions>

IMPORTANT: always wrap beforeCode/afterCode content in <![CDATA[ ... ]]> —
HTML tags inside them break the XML otherwise.
`.trim();

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
    <beforeCode><![CDATA[optional code snippet showing the problematic pattern]]></beforeCode>
    <afterCode><![CDATA[optional code snippet showing the fix]]></afterCode>
    <codeLanguage>html|javascript|css|http|bash</codeLanguage>
    <learnMore>https://... (optional)</learnMore>
  </suggestion>
</suggestions>

IMPORTANT: always wrap beforeCode/afterCode content in <![CDATA[ ... ]]> —
HTML tags inside them break the XML otherwise.
`.trim();

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmsDist(d: MetricDistribution | undefined, name: string): string {
  if (!d) return `${name}: no data`;
  const mobile  = d.byDevice.mobile  ? ` mobile p75=${fmt(name, d.byDevice.mobile.p75!)}` : '';
  const desktop = d.byDevice.desktop ? ` desktop p75=${fmt(name, d.byDevice.desktop.p75!)}` : '';
  return `${name}: p50=${fmt(name, d.p50)} p75=${fmt(name, d.p75)} p95=${fmt(name, d.p95)} [${d.rating}] n=${d.sampleSize}${mobile}${desktop}`;
}

function fmt(name: string, v: number): string {
  return name === 'CLS' ? v.toFixed(3) : `${Math.round(v)}ms`;
}

function ruleList(suggestions: Suggestion[]): string {
  if (!suggestions.length) return '  (none yet)';
  return suggestions.map(s => `  [${s.severity}] ${s.title}`).join('\n');
}

function header(sampleSize: number, confidence: string): string {
  return `Sample size: ${sampleSize} sessions · Confidence: ${confidence}`;
}

// ─── LCP agent ───────────────────────────────────────────────────────────────

export function buildLCPPrompt(
  lcp:         MetricDistribution,
  ttfb:        MetricDistribution | undefined,
  page:        PageContext,
  sampleSize:  number,
  confidence:  string,
  rules:       Suggestion[],
  phases?:     LCPPhaseSummary,
): string {
  const el = page.lcpElement;

  const phaseSection = phases
    ? `
## LCP Phase Breakdown (MEASURED, median of ${phases.sampleCount} session(s) — do not guess phases, use these)
  1. Time to first byte:      ${phases.timeToFirstByte      !== undefined ? Math.round(phases.timeToFirstByte)      + 'ms' : 'n/a'}
  2. Resource load delay:     ${phases.resourceLoadDelay    !== undefined ? Math.round(phases.resourceLoadDelay)    + 'ms' : 'n/a'}
  3. Resource load duration:  ${phases.resourceLoadDuration !== undefined ? Math.round(phases.resourceLoadDuration) + 'ms' : 'n/a'}
  4. Element render delay:    ${phases.elementRenderDelay   !== undefined ? Math.round(phases.elementRenderDelay)   + 'ms' : 'n/a'}
${phases.element ? `  Attributed element: ${phases.element}` : ''}`
    : '';

  const lcpEl = el
    ? [
        `  element: <${el.elementType}>${el.src ? ` src="${el.src}"` : ''}`,
        `  fetchpriority: ${el.fetchPriority ?? 'not set'}`,
        `  preloaded: ${el.isPreloaded ? 'yes' : 'no'}`,
        `  third-party: ${el.isThirdParty ? 'yes' : 'no'}`,
        el.naturalWidth ? `  natural size: ${el.naturalWidth}×${el.naturalHeight}px  display: ${el.displayWidth}×${el.displayHeight}px` : '',
      ].filter(Boolean).join('\n')
    : '  LCP element: not detected';

  return `
${header(sampleSize, confidence)}

## LCP Distribution
${fmsDist(lcp, 'LCP')}
${ttfb ? fmsDist(ttfb, 'TTFB') : ''}

## LCP Element
${lcpEl}
${phaseSection}

## Resource hints present in the document
${page.hints?.length
  ? page.hints.slice(0, 12).map(h => `  ${h.rel}${h.as ? `[as=${h.as}]` : ''} → ${h.href}${h.crossOrigin ? ' (crossorigin)' : ''}`).join('\n')
  : '  (none)'}

## Render-blocking scripts delaying LCP
  Count: ${page.scripts.filter(s => s.isRenderBlocking).length}
  Blocking stylesheets: ${page.stylesheets.filter(s => s.isRenderBlocking).length}

## Navigation timing (averages)
  TTFB breakdown: redirect=${page.navigationTiming.redirectTime}ms dns=${page.navigationTiming.dnsTime}ms tls=${page.navigationTiming.tlsTime}ms server=${page.navigationTiming.serverTime}ms download=${page.navigationTiming.downloadTime}ms

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — LCP specialist
Focus on what the rules missed. Investigate:
1. Is TTFB the primary bottleneck? If server time > 600ms, LCP cannot improve until that is fixed first.
   ${phases ? 'Use the MEASURED phase breakdown above to identify the dominant phase — do not speculate.' : ''}
2. Is the LCP element discovered late in the waterfall? Cross-correlate TTFB, render-blocking resources, and preload hints.
   ${phases?.resourceLoadDelay !== undefined ? 'A high "resource load delay" phase means late discovery — preload/priority hints fix exactly this.' : ''}
3. Are there cross-origin penalties (no preconnect, no early-hint) for the LCP resource?
4. Is the LCP image responsive? If natural size >> display size, bandwidth is wasted.
5. Could server-side rendering or streaming improve first-byte time for LCP text elements?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── CLS agent ───────────────────────────────────────────────────────────────

export function buildCLSPrompt(
  cls:        MetricDistribution,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
  sources?:   CLSSourceSummary,
): string {
  const sourceSection = sources
    ? `
## Shifted Elements (MEASURED across ${sources.sampleCount} session(s) — these are the actual shift sources, do not guess)
${sources.topSources.map(s => `  ${s.element} — shifted in ${s.sessions} session(s), cumulative shift ${s.totalShift.toFixed(4)}`).join('\n')}`
    : '';

  const unsizedImages = page.images.filter(i => !i.hasExplicitDimensions && i.isAboveFold);
  const badFonts      = page.fonts.filter(f => !f.isSystemFont && (f.display === 'auto' || f.display === 'block'));
  const webFonts      = page.fonts.filter(f => !f.isSystemFont && !f.isIconFont);

  return `
${header(sampleSize, confidence)}

## CLS Distribution
${fmsDist(cls, 'CLS')}
${sourceSection}

## Images (above-fold)
  Total above-fold images: ${page.images.filter(i => i.isAboveFold).length}
  Without explicit width/height: ${unsizedImages.length}
  With loading="lazy" above fold: ${page.images.filter(i => i.isAboveFold && i.loading === 'lazy').length}

## Fonts
  Total web fonts: ${webFonts.length}
  Without font-display:swap/optional: ${badFonts.length}
  Preloaded fonts: ${page.fonts.filter(f => f.isPreloaded).length}
  Fonts missing crossorigin: ${page.fonts.filter(f => f.isPreloaded && !f.hasCrossOrigin).length}

## DOM
  Total nodes: ${page.domNodeCount}
  Scripts: ${page.scripts.length} (${page.scripts.filter(s => s.isRenderBlocking).length} render-blocking)

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — CLS specialist
CLS is caused by unexpected layout shifts. The rules check for unsized images and missing font-display.
Go deeper and investigate:
1. ${sources ? 'The MEASURED shifted elements are listed above — trace each back to its cause (late image, injected banner, font swap) and propose the specific fix for that element.' : 'Dynamically injected content — cookie banners, ads, notifications, skeleton loaders. Is there a pattern in the DOM that suggests dynamic injection that pushes content down?'}
2. Web fonts — even with font-display:swap, a large font metric difference between fallback and web font causes shift. Are the fonts size-adjusted?
3. Animations — are any CSS transitions or JS animations using non-composited properties (top, left, width, height) instead of transform?
4. Iframes or embeds — do any third-party embeds (social widgets, maps) resize themselves after load?
5. Late-arriving above-fold images without aspect-ratio CSS or explicit dimensions.

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── INP agent ───────────────────────────────────────────────────────────────

export function buildINPPrompt(
  inp:        MetricDistribution,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
  phases?:    INPPhaseSummary,
): string {
  const syncThirdParty = page.scripts.filter(s => s.isThirdParty && s.position === 'head' && !s.isDeferred && !s.isAsync);
  const allThirdParty  = page.scripts.filter(s => s.isThirdParty);
  const mobileInp      = inp.byDevice.mobile?.p75;
  const desktopInp     = inp.byDevice.desktop?.p75;

  const phaseSection = phases
    ? `
## INP Phase Breakdown (MEASURED, median of ${phases.sampleCount} session(s) — do not guess phases, use these)
  Input delay:          ${phases.inputDelay         !== undefined ? Math.round(phases.inputDelay)         + 'ms' : 'n/a'}  (main thread busy when input arrived)
  Processing duration:  ${phases.processingDuration !== undefined ? Math.round(phases.processingDuration) + 'ms' : 'n/a'}  (event handler execution)
  Presentation delay:   ${phases.presentationDelay  !== undefined ? Math.round(phases.presentationDelay)  + 'ms' : 'n/a'}  (render after handlers)
${phases.topTargets.length ? '  Slowest interaction targets:\n' + phases.topTargets.map(t => `    ${t.target} (${t.count} session(s))`).join('\n') : ''}
${phases.interactionType ? `  Dominant interaction type: ${phases.interactionType}` : ''}`
    : '';

  return `
${header(sampleSize, confidence)}

## INP Distribution
${fmsDist(inp, 'INP')}
${mobileInp && desktopInp ? `  Mobile/desktop ratio: ${(mobileInp / desktopInp).toFixed(2)}× (mobile worse)` : ''}
${phaseSection}

## Scripts
  Total scripts: ${page.scripts.length}
  Third-party scripts: ${allThirdParty.length}
  Synchronous third-party in <head>: ${syncThirdParty.length}${syncThirdParty.length ? '\n  → ' + syncThirdParty.map(s => s.src ?? '(inline)').join(', ') : ''}
  Deferred: ${page.scripts.filter(s => s.isDeferred).length}
  Async: ${page.scripts.filter(s => s.isAsync).length}

## DOM complexity (affects event handler cost)
  DOM nodes: ${page.domNodeCount}
  First-party scripts: ${page.scripts.filter(s => !s.isThirdParty).length}

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — INP specialist
INP measures interaction latency — the time from a user gesture to the next frame paint.
The rules flag mobile gaps and synchronous third-party scripts. Go deeper:
1. Long tasks from first-party code — does DOM complexity, node count, or script count suggest heavy event handlers?
2. scheduler.postTask / setTimeout(0) opportunities — could expensive work be yielded to let the browser respond sooner?
3. ${phases ? 'The dominant INP phase is MEASURED above — target your suggestion at that phase specifically (input delay → break up long tasks; processing → optimize the named handler/target; presentation → reduce layout cost after handlers).' : 'Input delay vs processing time vs presentation delay — based on the INP value and device gap, which phase is likely dominant?'}
4. Third-party analytics or tag managers that fire on every click — even async scripts can block the input callback.
5. React/Vue/Angular hydration — does the framework timing suggest a hydration bottleneck before interactions are ready?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── TTFB agent ──────────────────────────────────────────────────────────────

export function buildTTFBPrompt(
  ttfb:       MetricDistribution,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
): string {
  const nav = page.navigationTiming;

  return `
${header(sampleSize, confidence)}

## TTFB Distribution
${fmsDist(ttfb, 'TTFB')}

## Navigation timing breakdown (averages across sessions)
  Redirect time:  ${nav.redirectTime}ms (${nav.redirectCount ?? 0} redirects)
  DNS lookup:     ${nav.dnsTime}ms
  TLS handshake:  ${nav.tlsTime}ms
  Server time:    ${nav.serverTime}ms   ← time from connection established to first byte
  Download time:  ${nav.downloadTime}ms
  Service Worker: ${nav.workerTime ?? 0}ms (active in ${nav.isServiceWorker ? 'yes' : 'no'} sessions)

## URL
  ${page.url}

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — TTFB specialist
TTFB is the sum of redirect + DNS + TLS + server response time. The rules flag obvious issues.
Go deeper and investigate:
1. Which component dominates? Server time > 400ms points to backend; TLS > 200ms points to no session resumption or OCSP; DNS > 100ms points to slow resolver.
2. Is there evidence of no CDN (high server time uniformly across all sessions vs geographically varied)?
3. Could HTTP/2 push or 103 Early Hints deliver critical subresources before the HTML is fully sent?
4. Service Worker fetch handling overhead — if SW is active, is navigation preload enabled?
5. Does the redirect chain suggest HTTP→HTTPS or www→non-www that could be eliminated at the DNS level?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── render-block agent ───────────────────────────────────────────────────────

export function buildRenderBlockPrompt(
  fcp:        MetricDistribution | undefined,
  lcp:        MetricDistribution | undefined,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
): string {
  const blockingScripts = page.scripts.filter(s => s.isRenderBlocking);
  const blockingSheets  = page.stylesheets.filter(s => s.isRenderBlocking);
  const totalScriptKb   = blockingScripts.reduce((s, sc) => s + (sc.size ?? 0), 0) / 1024;
  const totalSheetKb    = blockingSheets.reduce((s, ss) => s + (ss.transferSize ?? 0), 0) / 1024;

  return `
${header(sampleSize, confidence)}

## FCP / LCP Distributions
${fmsDist(fcp, 'FCP')}
${fmsDist(lcp, 'LCP')}

## Render-blocking scripts
  Count: ${blockingScripts.length}
  Total size: ${Math.round(totalScriptKb)}KB
  Sources:
${blockingScripts.map(s => `    ${s.src ?? '(inline)'} ${s.size ? `(${Math.round(s.size / 1024)}KB)` : ''}`).join('\n') || '    (none)'}

## Render-blocking stylesheets
  Count: ${blockingSheets.length}
  Total size: ${Math.round(totalSheetKb)}KB
  Sources:
${blockingSheets.map(s => `    ${s.href ?? '(inline)'} ${s.transferSize ? `(${Math.round(s.transferSize / 1024)}KB)` : ''}`).join('\n') || '    (none)'}

## Non-blocking scripts (async/defer/module)
  Deferred: ${page.scripts.filter(s => s.isDeferred).length}
  Async: ${page.scripts.filter(s => s.isAsync).length}
  Module: ${page.scripts.filter(s => s.isModule).length}

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — render-blocking specialist
The rules flag the presence of blocking scripts and stylesheets. Go deeper:
1. Which blocking resource has the highest individual cost? Large blocking scripts that could be split or inlined (critical path only) vs deferred?
2. Can any blocking stylesheets be converted to conditional loads (media queries) or inlined as critical CSS?
3. Are there synchronous scripts that only need to run after DOMContentLoaded? They could be defer'd with no functional change.
4. Is any blocking script a polyfill that modern browsers don't need? Could use module/nomodule pattern.
5. Would inlining critical CSS for above-fold content and lazy-loading the full stylesheet improve FCP meaningfully given the p75 value?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── resource-hint agent ─────────────────────────────────────────────────────

export function buildResourceHintPrompt(
  lcp:        MetricDistribution,
  fcp:        MetricDistribution | undefined,
  ttfb:       MetricDistribution | undefined,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
): string {
  const el = page.lcpElement;
  let pageOrigin = '';
  try { pageOrigin = new URL(page.url).origin; } catch { /* ignore */ }

  const thirdPartyOrigins = [...new Set(
    page.resources
      .map(r => { try { return new URL(r.name).origin; } catch { return ''; } })
      .filter(o => o && o !== pageOrigin)
  )];

  const hints = page.hints ?? [];

  return `
${header(sampleSize, confidence)}

## LCP / FCP / TTFB Distributions
${fmsDist(lcp, 'LCP')}
${fmsDist(fcp, 'FCP')}
${fmsDist(ttfb, 'TTFB')}

## LCP Element
  Type: ${el?.elementType ?? 'unknown'}
  src: ${el?.src ?? 'n/a'}
  Preloaded: ${el?.isPreloaded ? 'yes' : 'no'}
  fetchpriority: ${el?.fetchPriority ?? 'not set'}
  Third-party: ${el?.isThirdParty ? 'yes' : 'no'}

## Existing resource hints (${hints.length} total)
${hints.slice(0, 12).map(h => `  ${h.rel}${h.as ? `[as=${h.as}]` : ''} → ${h.href}${h.crossOrigin ? ' (crossorigin)' : ''}`).join('\n') || '  (none)'}
  Third-party origins on page: ${thirdPartyOrigins.length}
  Origins: ${thirdPartyOrigins.slice(0, 8).join(', ') || 'none'}

## Key resources (by transfer size, top 5)
${page.resources
  .sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0))
  .slice(0, 5)
  .map(r => `  ${r.name.slice(-60)} ${r.transferSize ? Math.round(r.transferSize / 1024) + 'KB' : ''} ${r.initiatorType}`)
  .join('\n') || '  (no data)'}

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — resource hint specialist
Resource hints (preload, preconnect, prefetch, dns-prefetch, modulepreload) tell the browser
what to fetch before it discovers resources organically. The rules check for missing LCP preload
and obvious preconnect gaps. Go deeper:
1. Is the LCP resource on a third-party CDN that needs both preconnect AND preload?
2. Are there critical fonts, scripts, or API calls early in the render path that would benefit from preload?
3. Are there third-party origins whose DNS resolution could be started earlier with dns-prefetch?
4. Could modulepreload for ES module entry points improve FCP/LCP?
5. Are any existing preload hints wasted (preloading resources that are already in the critical path and discovered early)?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── image agent ─────────────────────────────────────────────────────────────

export function buildImagePrompt(
  lcp:        MetricDistribution | undefined,
  fcp:        MetricDistribution | undefined,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
): string {
  const el       = page.lcpElement;
  const lcpImg   = page.images.find(i => i.isLCP);
  const aboveFold = page.images.filter(i => i.isAboveFold);
  const lazyAboveFold = aboveFold.filter(i => i.loading === 'lazy');
  const noSrcset  = aboveFold.filter(i => !i.isResponsive);

  return `
${header(sampleSize, confidence)}

## LCP / FCP Distributions
${fmsDist(lcp, 'LCP')}
${fmsDist(fcp, 'FCP')}

## LCP Image
  Format: ${lcpImg?.format ?? 'unknown'}
  Natural size: ${el?.naturalWidth ?? '?'}×${el?.naturalHeight ?? '?'}px
  Display size: ${el?.displayWidth ?? '?'}×${el?.displayHeight ?? '?'}px
  Oversize ratio: ${el?.naturalWidth && el?.displayWidth ? (el.naturalWidth / el.displayWidth).toFixed(2) + '×' : 'unknown'}
  fetchpriority: ${el?.fetchPriority ?? 'not set'}
  loading: ${lcpImg?.loading ?? 'unknown'}
  Has srcset: ${lcpImg?.isResponsive ? 'yes' : 'no'}

## Above-fold images (${aboveFold.length} total)
  With loading="lazy": ${lazyAboveFold.length}
  Without srcset: ${noSrcset.length}
  Without explicit dimensions: ${aboveFold.filter(i => !i.hasExplicitDimensions).length}

## All images
  Total: ${page.images.length}
  Below-fold without lazy: ${page.images.filter(i => !i.isAboveFold && i.loading !== 'lazy').length}

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — image specialist
Images are the most common LCP bottleneck. The rules check format, oversize ratio, and lazy loading.
Go deeper:
1. Is the LCP image decoded on the main thread (no lazy, but also no decoding="async")? Large images can block rendering during decode.
2. Are there responsive image opportunities (srcset + sizes) that would reduce bandwidth on mobile significantly?
3. Could AVIF over WebP provide meaningful additional savings for the LCP image given its format and content type?
4. Are below-fold images missing loading="lazy", unnecessarily consuming bandwidth before the LCP image finishes?
5. Could image compression quality be tuned (e.g. WebP quality 80 vs 90) for the LCP image to reduce transfer size?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── font agent ───────────────────────────────────────────────────────────────

export function buildFontPrompt(
  fcp:        MetricDistribution | undefined,
  cls:        MetricDistribution | undefined,
  page:       PageContext,
  sampleSize: number,
  confidence: string,
  rules:      Suggestion[],
): string {
  const webFonts         = page.fonts.filter(f => !f.isSystemFont && !f.isIconFont);
  const preloaded        = webFonts.filter(f => f.isPreloaded);
  const missingCrossOrigin = webFonts.filter(f => f.isPreloaded && !f.hasCrossOrigin);
  const badDisplay       = webFonts.filter(f => f.display === 'auto' || f.display === 'block');
  const noDisplay        = webFonts.filter(f => !f.display);

  return `
${header(sampleSize, confidence)}

## FCP / CLS Distributions
${fmsDist(fcp, 'FCP')}
${fmsDist(cls, 'CLS')}

## Web fonts (${webFonts.length} total, excluding system and icon fonts)
${webFonts.map(f => [
  `  ${f.family ?? 'unknown family'}`,
  `    url: ${f.url ?? 'n/a'}`,
  `    display: ${f.display ?? 'not set'}`,
  `    preloaded: ${f.isPreloaded ? 'yes' : 'no'}`,
  `    crossorigin: ${f.hasCrossOrigin ? 'yes' : 'no'}`,
  `    format: ${f.format ?? 'unknown'}`,
].join('\n')).join('\n') || '  (none)'}

## Summary
  Preloaded: ${preloaded.length} / ${webFonts.length}
  Missing crossorigin on preload: ${missingCrossOrigin.length}
  Using font-display:auto or block (causes FOIT): ${badDisplay.length}
  No font-display set: ${noDisplay.length}

## Rule-based findings already identified (do NOT repeat these)
${ruleList(rules)}

## Your task — font loading specialist
Font loading affects both FCP (invisible text during load) and CLS (layout shift when font swaps).
The rules catch missing preload, missing crossorigin, and missing font-display. Go deeper:
1. Are fonts self-hosted or served from Google Fonts / Adobe / other CDN? CDN fonts add a cross-origin round-trip that preconnect alone doesn't fully solve.
2. Are there more font weights/variants declared than are actually used on the page? Unused variants waste bandwidth.
3. Could font-display:optional eliminate CLS entirely for decorative fonts (where invisible text briefly is acceptable)?
4. Is unicode-range subsetting applied? Large fonts for Latin-only pages can be subsetted aggressively.
5. Are variable fonts available that could replace multiple weight files with a single file?

Generate 0-3 specific suggestions the rule-based layer did not catch. If nothing qualifies, return <suggestions/>.

${ANTHROPIC_OUTPUT_SCHEMA}
`.trim();
}

// ─── trace agent (unchanged — already has its own dedicated prompt) ───────────

export function buildTraceUserPrompt(
  distributions: Partial<Record<string, MetricDistribution>>,
  page:          PageContext,
  trace:         TraceMetrics,
  sampleSize:    number,
  confidence:    string,
  runProfile?:   string,
): string {
  return `
## Analysis Context
- Sample size: ${sampleSize} sessions
- Confidence: ${confidence}
- Agent: trace (CPU / rendering profiler)
${runProfile ? `- Run conditions: ${runProfile}` : ''}

## Core Web Vitals Distributions (p50 / p75 / p95)
${Object.entries(distributions)
  .map(([name, d]) => d ? fmsDist(d, name) : '')
  .filter(Boolean).join('\n')}

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
URL: ${page.url}
DOM nodes: ${page.domNodeCount}
Scripts: ${page.scripts.length} (${page.scripts.filter(s => s.isRenderBlocking).length} render-blocking)

## Your task
You are analyzing CPU and rendering performance from a real CDP trace.
Cross-correlate the trace breakdown with the Core Web Vitals to identify the root cause:

1. Is the primary bottleneck scripting, rendering/layout, or network (low main-thread work but poor LCP)?
2. Which specific scripts or functions are the direct cause?
3. Are the long tasks caused by JS execution, layout thrashing, or something else?
4. Do the mobile/desktop CWV splits suggest this is a device-capability issue (high JS compile) or a network issue?

Generate 0-4 specific, root-cause suggestions. If the trace shows no clear problem, return <suggestions/>. Avoid generic advice — reference the actual
script names, function names, and millisecond values from the trace data above.

${TRACE_OUTPUT_SCHEMA}
`.trim();
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
