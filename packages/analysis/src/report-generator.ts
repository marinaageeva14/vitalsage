import type { AnalysisReport, Suggestion, MetricName } from '@vitalsage/types';
import type { TraceMetrics } from '@vitalsage/types';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  warning:  '#f59e0b',
  info:     '#6b7280',
};

const RATING_COLOR: Record<string, string> = {
  good:                '#22c55e',
  'needs-improvement': '#f59e0b',
  poor:                '#ef4444',
};

export function generateHtmlReport(reports: AnalysisReport[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VitalSage Analysis Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e2e8f0; line-height: 1.5; padding: 24px; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 8px; color: #f8fafc; }
  h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; color: #94a3b8; }
  h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 4px; }
  .report-header { margin-bottom: 32px; }
  .generated-at { color: #64748b; font-size: 0.85rem; }
  .route-block { background: #1e2130; border: 1px solid #2d3748; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .route-title { font-size: 1rem; font-weight: 700; color: #f8fafc; margin-bottom: 4px; }
  .route-meta { font-size: 0.8rem; color: #64748b; margin-bottom: 16px; }
  .distributions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
  .dist-card { background: #0f1117; border: 1px solid #2d3748; border-radius: 6px; padding: 10px 14px; min-width: 120px; }
  .dist-metric { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
  .dist-p75 { font-size: 1.1rem; font-weight: 700; margin: 2px 0; }
  .dist-rating { font-size: 0.72rem; padding: 2px 6px; border-radius: 9999px; display: inline-block; color: #fff; }
  .suggestions { display: flex; flex-direction: column; gap: 12px; }
  .suggestion { background: #0f1117; border-left: 3px solid; border-radius: 6px; padding: 12px 16px; }
  .suggestion-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .severity-badge { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 9999px; color: #fff; }
  .suggestion-title { font-weight: 600; color: #f1f5f9; font-size: 0.9rem; }
  .suggestion-detail { font-size: 0.82rem; color: #94a3b8; margin-bottom: 8px; }
  .suggestion-meta { font-size: 0.75rem; color: #64748b; display: flex; gap: 12px; flex-wrap: wrap; }
  .code-block { background: #161b27; border: 1px solid #2d3748; border-radius: 4px; padding: 10px; margin-top: 8px; overflow-x: auto; }
  .code-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
  pre { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.78rem; white-space: pre-wrap; color: #e2e8f0; }
  .learn-more { font-size: 0.78rem; color: #6366f1; text-decoration: none; margin-top: 6px; display: inline-block; }
  .learn-more:hover { text-decoration: underline; }
  .insufficient { color: #64748b; font-style: italic; font-size: 0.85rem; }
  footer { margin-top: 32px; color: #4b5563; font-size: 0.75rem; text-align: center; }

  /* screenshot */
  .trace-layout { display: flex; gap: 20px; margin-bottom: 20px; align-items: flex-start; flex-wrap: wrap; }
  .screenshot-wrap { flex: 0 0 auto; }
  .page-screenshot { width: 320px; max-width: 100%; border-radius: 6px; border: 1px solid #2d3748; display: block; }

  /* trace metrics panel */
  .trace-panel { flex: 1 1 300px; background: #0f1117; border: 1px solid #2d3748; border-radius: 6px; padding: 14px; }
  .trace-panel-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 12px; }
  .trace-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.8rem; }
  .trace-bar-label { width: 80px; color: #94a3b8; flex-shrink: 0; }
  .trace-bar-track { flex: 1; background: #1e2130; border-radius: 3px; height: 8px; overflow: hidden; }
  .trace-bar-fill { height: 100%; border-radius: 3px; }
  .trace-bar-value { width: 70px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .trace-kv { display: flex; justify-content: space-between; font-size: 0.8rem; padding: 3px 0; border-bottom: 1px solid #1e2130; }
  .trace-kv:last-child { border-bottom: none; }
  .trace-kv-label { color: #94a3b8; }
  .trace-kv-value { font-variant-numeric: tabular-nums; }
  .good   { color: #22c55e; }
  .warn   { color: #f59e0b; }
  .crit   { color: #ef4444; }
  .dim    { color: #64748b; }
</style>
</head>
<body>
<div class="report-header">
  <h1>VitalSage Analysis Report</h1>
  <p class="generated-at">Generated ${new Date().toISOString()}</p>
</div>
${reports.map(renderRoute).join('\n')}
<footer>Generated by VitalSage ${reports[0]?.analysisVersion ?? ''}</footer>
</body>
</html>`;
}

function renderRoute(report: AnalysisReport): string {
  const pattern = report.route.pattern;
  const conf    = report.confidence;
  const from    = new Date(report.timeWindow.from).toLocaleDateString();
  const to      = new Date(report.timeWindow.to).toLocaleDateString();

  const traceLayout = (report.screenshot || report.traceMetrics)
    ? `<div class="trace-layout">
        ${report.screenshot ? renderScreenshot(report.screenshot) : ''}
        ${report.traceMetrics ? renderTracePanel(report.traceMetrics) : ''}
      </div>`
    : '';

  return `<div class="route-block">
  <div class="route-title">${escHtml(pattern)}</div>
  <div class="route-meta">${report.sampleSize} sessions · confidence: ${conf} · ${from} – ${to}</div>
  ${traceLayout}
  ${renderDistributions(report)}
  <h3>Suggestions (${report.suggestions.length})</h3>
  <div class="suggestions">
    ${report.suggestions.map(renderSuggestion).join('\n    ')}
  </div>
</div>`;
}

function renderScreenshot(b64: string): string {
  return `<div class="screenshot-wrap">
    <img src="data:image/jpeg;base64,${b64}" class="page-screenshot" alt="Page screenshot" />
  </div>`;
}

function renderTracePanel(tm: TraceMetrics): string {
  const total = Math.max(tm.mainThreadWork, 1);

  function barColor(v: number, warn: number, crit: number): string {
    if (v >= crit) return '#ef4444';
    if (v >= warn) return '#f59e0b';
    return '#22c55e';
  }
  function valClass(v: number, warn: number, crit: number): string {
    if (v >= crit) return 'crit';
    if (v >= warn) return 'warn';
    return 'good';
  }
  function bar(label: string, ms: number, warn: number, crit: number): string {
    const pct   = Math.min(ms / total, 1) * 100;
    const color = barColor(ms, warn, crit);
    const cls   = valClass(ms, warn, crit);
    return `<div class="trace-bar-row">
      <span class="trace-bar-label">${label}</span>
      <div class="trace-bar-track"><div class="trace-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <span class="trace-bar-value ${cls}">${Math.round(ms).toLocaleString()}ms</span>
    </div>`;
  }
  function kv(label: string, value: string, cls = 'dim'): string {
    return `<div class="trace-kv"><span class="trace-kv-label">${label}</span><span class="trace-kv-value ${cls}">${value}</span></div>`;
  }

  const tbtCls   = valClass(tm.totalBlockingTime, 300, 600);
  const layoutCls = valClass(tm.layoutCount, 15, 30);
  const recalcCls = valClass(tm.styleRecalcCount, 50, 100);
  const heapCls   = tm.jsHeapUsed !== undefined ? (tm.jsHeapUsed >= 100 ? 'warn' : 'good') : 'dim';

  return `<div class="trace-panel">
    <div class="trace-panel-title">Main Thread CPU Breakdown</div>
    <div style="font-size:0.72rem;color:#64748b;margin-bottom:10px">CPU time only — does not include network/idle wait</div>
    ${bar('JS Execute',  tm.scriptingTime,  500,  1500)}
    ${bar('JS Compile',  tm.jsCompileTime,  200,   800)}
    ${bar('Rendering',   tm.renderingTime,  200,   800)}
    <div class="trace-bar-row" style="opacity:0.45">
      <span class="trace-bar-label">Paint</span>
      <span style="font-size:0.75rem;color:#64748b">compositor-threaded · off main thread</span>
    </div>
    <div style="margin-top:12px">
      ${kv('Total Blocking Time', `${Math.round(tm.totalBlockingTime).toLocaleString()}ms · ${tm.longTaskCount} task(s)`, tbtCls)}
      ${kv('Forced Layouts',  String(tm.layoutCount),    layoutCls)}
      ${kv('Style Recalcs',   String(tm.styleRecalcCount), recalcCls)}
      ${kv('DOM Nodes',       String(tm.domNodes))}
      ${kv('JS Listeners',    String(tm.jsListeners))}
      ${tm.jsHeapUsed !== undefined ? kv('JS Heap', `${tm.jsHeapUsed}MB`, heapCls) : ''}
    </div>
  </div>`;
}

function renderDistributions(report: AnalysisReport): string {
  const cards = (Object.entries(report.distributions) as [MetricName, NonNullable<typeof report.distributions[MetricName]>][])
    .filter(([, d]) => d != null)
    .map(([name, d]) => {
      const p75Str = name === 'CLS' ? d.p75.toFixed(3) : `${Math.round(d.p75)}ms`;
      const ratingColor = RATING_COLOR[d.rating] ?? '#6b7280';
      return `<div class="dist-card">
      <div class="dist-metric">${name}</div>
      <div class="dist-p75" style="color:${ratingColor}">${p75Str}</div>
      <span class="dist-rating" style="background:${ratingColor}">${d.rating}</span>
    </div>`;
    });

  if (!cards.length) return '';
  return `<div class="distributions">${cards.join('')}</div>`;
}

function renderSuggestion(s: Suggestion): string {
  const color = SEVERITY_COLOR[s.severity] ?? '#6b7280';
  const codeHtml = s.codeExample
    ? `<div class="code-block">
      <div class="code-label">Before</div>
      <pre>${escHtml(s.codeExample.before)}</pre>
      <div class="code-label" style="margin-top:8px">After</div>
      <pre>${escHtml(s.codeExample.after)}</pre>
    </div>`
    : '';

  const learnMore = s.learnMore
    ? `<a class="learn-more" href="${escHtml(s.learnMore)}" target="_blank" rel="noopener">Learn more →</a>`
    : '';

  return `<div class="suggestion" style="border-color:${color}">
    <div class="suggestion-header">
      <span class="severity-badge" style="background:${color}">${s.severity}</span>
      <span class="suggestion-title">${escHtml(s.title)}</span>
    </div>
    <p class="suggestion-detail">${escHtml(s.detail)}</p>
    <div class="suggestion-meta">
      <span>effort: ${s.effort}</span>
      <span>confidence: ${Math.round(s.confidence * 100)}%</span>
      <span>impact: ${escHtml(s.estimatedImpact)}</span>
      ${s.affectedPercent !== undefined ? `<span>affected: ${Math.round(s.affectedPercent * 100)}%</span>` : ''}
    </div>
    ${codeHtml}
    ${learnMore}
  </div>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
