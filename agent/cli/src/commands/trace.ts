import { writeFile }  from 'node:fs/promises';
import type { TraceMetrics, NetworkProfile, ViewportProfile, SessionReport } from '@vitalsage/types';
import type { Suggestion } from '@vitalsage/types';
import { printSuccess, printError, printInfo } from '../output/terminal.js';

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';

function color(text: string, c: string): string { return `${c}${text}${RESET}`; }
function bar(pct: number, width = 30): string {
  const filled = Math.round(pct * width);
  return color('█'.repeat(filled) + '░'.repeat(width - filled), DIM);
}

function fmtMs(ms: number): string { return `${Math.round(ms).toLocaleString()}ms`; }
function fmtMb(mb: number): string { return `${mb}MB`; }

function traceColor(value: number, warn: number, crit: number): string {
  if (value >= crit)  return RED;
  if (value >= warn)  return YELLOW;
  return GREEN;
}

function printCoreWebVitals(sessions: SessionReport[]): void {
  if (sessions.length === 0) return;

  const avg = (metric: string): number | undefined => {
    const vals = sessions
      .map(s => (s.metrics as Record<string, { value: number } | undefined>)[metric]?.value)
      .filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };

  const lcp  = avg('LCP');
  const fcp  = avg('FCP');
  const cls  = avg('CLS');
  const ttfb = avg('TTFB');
  const inp  = avg('INP');

  console.log('');
  console.log(color('━'.repeat(50), DIM));
  console.log(`  ${color('Core Web Vitals', BOLD)}  ${color(`(avg of ${sessions.length} run${sessions.length > 1 ? 's' : ''})`, DIM)}`);
  console.log(color('━'.repeat(50), DIM));

  function cwvLine(label: string, value: number | undefined, unit: string, good: number, poor: number): void {
    if (value === undefined) { console.log(`  ${label.padEnd(22)}${color('no data', DIM)}`); return; }
    const rounded = unit === 'cls' ? value.toFixed(3) : `${Math.round(value).toLocaleString()}ms`;
    const c = value <= good ? GREEN : value <= poor ? YELLOW : RED;
    console.log(`  ${label.padEnd(22)}${color(rounded.padStart(10), c)}`);
  }

  cwvLine('LCP',   lcp,  'ms',  2500, 4000);
  cwvLine('FCP',   fcp,  'ms',  1800, 3000);
  cwvLine('TTFB',  ttfb, 'ms',   800, 1800);
  cwvLine('CLS',   cls,  'cls', 0.10, 0.25);
  cwvLine('INP',   inp,  'ms',   200,  500);
}

/**
 * Average TraceMetrics across all sessions that have trace data.
 * Long tasks are taken from the run with the highest TBT (most representative).
 */
function averageTraceMetrics(sessions: SessionReport[]): TraceMetrics | undefined {
  const tms = sessions.map(s => s.page.traceMetrics).filter((tm): tm is TraceMetrics => tm !== undefined);
  if (tms.length === 0) return undefined;

  const avg = (fn: (tm: TraceMetrics) => number): number =>
    tms.reduce((sum, tm) => sum + fn(tm), 0) / tms.length;

  const worst = tms.reduce((a, b) => a.totalBlockingTime >= b.totalBlockingTime ? a : b);

  return {
    totalBlockingTime: avg(tm => tm.totalBlockingTime),
    longTaskCount:     Math.round(avg(tm => tm.longTaskCount)),
    longTasks:         worst.longTasks,               // worst-run tasks as representative sample
    mainThreadWork:    avg(tm => tm.mainThreadWork),
    scriptingTime:     avg(tm => tm.scriptingTime),
    jsCompileTime:     avg(tm => tm.jsCompileTime),
    renderingTime:     avg(tm => tm.renderingTime),
    layoutCount:       Math.round(avg(tm => tm.layoutCount)),
    styleRecalcCount:  Math.round(avg(tm => tm.styleRecalcCount)),
    domNodes:          Math.round(avg(tm => tm.domNodes)),
    jsListeners:       Math.round(avg(tm => tm.jsListeners)),
    ...(tms.some(tm => tm.jsHeapUsed !== undefined)
      ? { jsHeapUsed: Math.round(avg(tm => tm.jsHeapUsed ?? 0)) }
      : {}),
  };
}

function printTraceMetrics(tm: TraceMetrics, runCount: number): void {
  console.log('');
  console.log(color('━'.repeat(50), DIM));
  console.log(`  ${color('Main Thread Breakdown', BOLD)}  ${color(`(avg of ${runCount} run${runCount > 1 ? 's' : ''}, CPU time)`, DIM)}`);
  console.log(color('━'.repeat(50), DIM));

  const total = Math.max(tm.mainThreadWork, 1);

  const rows: Array<[string, number, number, number]> = [
    ['JS Execute',  tm.scriptingTime,  500,  1500],
    ['JS Compile',  tm.jsCompileTime,  200,   800],
    ['Rendering',   tm.renderingTime,  200,   800],
  ];

  for (const [label, value, warn, crit] of rows) {
    const c   = traceColor(value, warn, crit);
    const pct = Math.min(value / total, 1);
    const pad = ' '.repeat(Math.max(0, 12 - label.length));
    console.log(`  ${color(label, BOLD)}${pad}  ${bar(pct)}  ${color(fmtMs(value).padStart(8), c)}`);
  }
  console.log(`  ${color('Paint', DIM)}${''.padStart(10)}  ${color('compositor-threaded (off main thread)', DIM)}`);

  console.log('');
  console.log(`  ${color('Key Metrics', BOLD)}`);
  console.log(color('─'.repeat(50), DIM));

  const tbtColor = traceColor(tm.totalBlockingTime, 300, 600);
  console.log(`  ${'TBT'.padEnd(22)}${color(fmtMs(tm.totalBlockingTime).padStart(8), tbtColor)}  ${color(`${tm.longTaskCount} long task(s)`, DIM)}`);

  const layoutColor = traceColor(tm.layoutCount, 15, 30);
  console.log(`  ${'Forced Layouts'.padEnd(22)}${color(String(tm.layoutCount).padStart(8), layoutColor)}`);

  const recalcColor = traceColor(tm.styleRecalcCount, 50, 100);
  console.log(`  ${'Style Recalcs'.padEnd(22)}${color(String(tm.styleRecalcCount).padStart(8), recalcColor)}`);

  console.log(`  ${'DOM Nodes'.padEnd(22)}${color(String(tm.domNodes).padStart(8), DIM)}`);
  console.log(`  ${'JS Listeners'.padEnd(22)}${color(String(tm.jsListeners).padStart(8), DIM)}`);

  if (tm.jsHeapUsed !== undefined) {
    const heapColor = tm.jsHeapUsed >= 100 ? YELLOW : GREEN;
    console.log(`  ${'JS Heap'.padEnd(22)}${color(fmtMb(tm.jsHeapUsed).padStart(8), heapColor)}`);
  }

  if (tm.longTasks.length > 0) {
    console.log('');
    console.log(`  ${color('Top Long Tasks', BOLD)}  ${color('(from worst run)', DIM)}`);
    console.log(color('─'.repeat(50), DIM));
    const top = tm.longTasks.slice(0, 5);
    for (const t of top) {
      const dColor = t.duration >= 200 ? RED : YELLOW;
      console.log(`  ${color(fmtMs(t.duration).padStart(8), dColor)}  ${color(`blocking: ${fmtMs(t.blocking)}`, DIM)}  ${color(`@ ${fmtMs(t.startTime)}`, DIM)}`);
    }
  }

  // Per-function flame chart — only present with --full-report
  if (tm.topFunctions && tm.topFunctions.length > 0) {
    const totalSelf = tm.topFunctions.reduce((s, f) => s + f.selfTime, 0);
    console.log('');
    console.log(`  ${color('Flame Chart — Top Functions by Self Time', BOLD)}  ${color('(V8 CPU profiler, same as DevTools)', DIM)}`);
    console.log(color('─'.repeat(60), DIM));
    console.log(`  ${color('Self'.padStart(8), DIM)}  ${color('Total'.padStart(8), DIM)}  ${color('%'.padStart(5), DIM)}  ${color('Function', DIM)}`);
    console.log(color('─'.repeat(60), DIM));

    for (const fn of tm.topFunctions.slice(0, 15)) {
      const share     = totalSelf > 0 ? fn.selfTime / totalSelf : 0;
      const selfColor = fn.selfTime >= 200 ? RED : fn.selfTime >= 50 ? YELLOW : DIM;
      const selfStr   = color(fmtMs(fn.selfTime).padStart(8), selfColor);
      const totalStr  = color(fmtMs(fn.totalTime).padStart(8), DIM);
      const pctStr    = color(`${Math.round(share * 100)}%`.padStart(5), DIM);
      const fnName    = fn.functionName || color('(anonymous)', DIM);
      const src       = fn.url
        ? color(` ${fn.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || fn.url}:${fn.lineNumber}`, DIM)
        : '';
      console.log(`  ${selfStr}  ${totalStr}  ${pctStr}  ${fnName}${src}`);
    }
    if (tm.topFunctions.length > 15) {
      console.log(`  ${color(`…and ${tm.topFunctions.length - 15} more functions`, DIM)}`);
    }
  }

  // Per-script breakdown — only present when CDP trace events were collected
  if (tm.topScripts && tm.topScripts.length > 0) {
    console.log('');
    console.log(`  ${color('JS Execution by Script', BOLD)}  ${color('(from CDP trace events, same as DevTools flame chart)', DIM)}`);
    console.log(color('─'.repeat(60), DIM));

    const scriptTotal = tm.topScripts.reduce((s, sc) => s + sc.time, 0);
    for (const sc of tm.topScripts) {
      const label = sc.url
        ? sc.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || sc.url
        : color('(inline / anonymous)', DIM);
      const pct      = sc.share;
      const timeStr  = fmtMs(sc.time).padStart(8);
      const pctStr   = `${Math.round(pct * 100)}%`.padStart(5);
      const timeColor = sc.time >= 300 ? (sc.time >= 800 ? RED : YELLOW) : GREEN;
      const barWidth  = Math.round(pct * 20);
      const miniBar   = color('█'.repeat(barWidth) + '░'.repeat(20 - barWidth), DIM);
      console.log(`  ${color(timeStr, timeColor)}  ${color(pctStr, DIM)}  ${miniBar}  ${label}`);
    }
    if (scriptTotal > 0) {
      console.log(`  ${color('─'.repeat(58), DIM)}`);
      console.log(`  ${color(fmtMs(scriptTotal).padStart(8), DIM)}  ${color('total measured scripting', DIM)}`);
    }
  }
}

/**
 * Strip numeric values from a suggestion title to get a stable fingerprint
 * that matches across runs regardless of slightly different measured values.
 *
 * Example: "Total Blocking Time is 312ms — 5 long task(s)"
 *       → "total blocking time is Nms — N long task(s)"
 */
function normalizeTitle(title: string): string {
  return title
    .replace(/[\d,]+(?:\.\d+)?(?:ms|MB|%|s)?/g, 'N')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group suggestions by their normalized fingerprint (agent + normalized title).
 * Returns only those that appear in at least `threshold` out of `totalRuns` runs.
 * The returned suggestion object is taken from the run where it appeared first.
 */
function filterConsistentFindings(
  perRunSuggestions: Suggestion[][],
  threshold: number,
): Array<{ suggestion: Suggestion; runsFound: number }> {
  // key → { count, first suggestion seen }
  const counts = new Map<string, { runsFound: number; suggestion: Suggestion }>();

  for (const runSugs of perRunSuggestions) {
    // Deduplicate within a single run before counting
    const seenInRun = new Set<string>();
    for (const s of runSugs) {
      const key = `${s.agent}::${normalizeTitle(s.title)}`;
      if (seenInRun.has(key)) continue;
      seenInRun.add(key);

      const existing = counts.get(key);
      if (existing) {
        existing.runsFound++;
      } else {
        counts.set(key, { runsFound: 1, suggestion: s });
      }
    }
  }

  return Array.from(counts.values())
    .filter(entry => entry.runsFound >= threshold)
    .sort((a, b) => {
      // Sort: more runs first, then by severity
      if (b.runsFound !== a.runsFound) return b.runsFound - a.runsFound;
      const sev = { critical: 0, warning: 1, info: 2 };
      return (sev[a.suggestion.severity as keyof typeof sev] ?? 2)
           - (sev[b.suggestion.severity as keyof typeof sev] ?? 2);
    });
}

export interface TraceArgs {
  url:          string;
  runs:         number;
  network:      string;
  viewport:     string;
  output?:      string;
  delay?:       number;
  fullReport?:  boolean;
  aiProvider?:  string;
  aiKey?:       string;
  aiModel?:     string;
}

export async function runTrace(args: TraceArgs): Promise<void> {
  const { PlaywrightSimulator } = await import('vitalsage-simulator');
  const { AnalysisEngine, generateHtmlReport } = await import('vitalsage-analysis');

  printInfo(`Capturing performance trace for ${color(args.url, CYAN)}`);
  printInfo(`${args.runs} run(s) · network: ${args.network} · viewport: ${args.viewport}${args.fullReport ? ' · ' + color('full CPU profiler enabled', YELLOW) : ''}`);
  if (args.fullReport) {
    printInfo(`Full report mode: recording per-function call stacks (expect larger traces and ~10–15% overhead)`);
  }
  printInfo(`Only findings consistent across ${args.runs > 1 ? 'multiple' : 'all'} runs will be reported`);

  // Suppress internal simulator logs
  const origLog = console.log.bind(console);
  console.log   = (...a: unknown[]) => {
    const msg = String(a[0] ?? '');
    if (!msg.includes('[VitalSage Simulator]')) origLog(...a);
  };

  let sessions: SessionReport[];
  try {
    const simulator = new PlaywrightSimulator();
    sessions = await simulator.simulate({
      url:                args.url,
      runs:               args.runs,
      outputDir:          '.vitalsage-trace-tmp',
      concurrency:        1,
      captureTrace:       true,
      captureFullTrace:   args.fullReport ?? false,
      networks:           [args.network as NetworkProfile],
      viewports:          [args.viewport as ViewportProfile],
      waitAfterLoad:      3000,
      delayBetweenRuns:   args.delay ?? 2000,
      interactAfterLoad:  false, // no click → LCP observer stays live for all candidates
    });
  } finally {
    console.log = origLog;
  }

  if (sessions.length === 0) {
    printError('No sessions collected — check the URL and try again');
    process.exit(1);
  }

  printSuccess(`Captured ${sessions.length} session(s)`);

  // ── Core Web Vitals (averaged across all runs) ──────────────────────
  printCoreWebVitals(sessions);

  // ── Trace metrics (averaged across runs that have trace data) ───────
  const avgTrace = averageTraceMetrics(sessions);
  if (avgTrace) {
    const traceRunCount = sessions.filter(s => s.page.traceMetrics).length;
    printTraceMetrics(avgTrace, traceRunCount);
  }

  // ── Per-run analysis then cross-run consistency filter ───────────────
  const aiConfig = args.aiProvider && args.aiKey
    ? { provider: args.aiProvider as 'anthropic' | 'openai' | 'gemini', apiKey: args.aiKey, ...(args.aiModel ? { model: args.aiModel } : {}) }
    : undefined;

  const engine = new AnalysisEngine({ ...(aiConfig ? { ai: aiConfig } : {}) });

  // Analyze each run independently
  const perRunSuggestions: Suggestion[][] = [];
  for (let i = 0; i < sessions.length; i++) {
    const runReports = await engine.analyze([sessions[i]!], { minSamples: 1 });
    perRunSuggestions.push(runReports[0]?.suggestions ?? []);
  }

  // Require a finding in at least ceil(runs * 2/3) runs to filter noise.
  // With 3 runs that means 2/3; with 1 run that means 1/1.
  const consistencyThreshold = Math.max(1, Math.ceil(sessions.length * (2 / 3)));
  const consistent = filterConsistentFindings(perRunSuggestions, consistencyThreshold);

  const traceSuggestions = consistent.filter(e => e.suggestion.agent === 'trace');
  const otherSuggestions = consistent.filter(e => e.suggestion.agent !== 'trace');

  console.log('');
  console.log(color('━'.repeat(50), DIM));
  console.log(`  ${color('Findings', BOLD)}  ${color(`(consistent across ≥${consistencyThreshold}/${sessions.length} run${sessions.length > 1 ? 's' : ''})`, DIM)}`);
  console.log(color('━'.repeat(50), DIM));

  if (traceSuggestions.length === 0 && otherSuggestions.length === 0) {
    console.log(`  ${color('✓ No consistent issues detected', GREEN)}`);
  }

  for (const { suggestion: s, runsFound } of traceSuggestions) {
    const sc  = s.severity === 'critical' ? RED : YELLOW;
    const tag = color(`[${s.severity.toUpperCase()}]`, sc);
    const runBadge = sessions.length > 1
      ? color(` (${runsFound}/${sessions.length} runs)`, DIM)
      : '';
    console.log('');
    console.log(`  ${tag}${runBadge} ${color(s.title, BOLD)}`);
    console.log(`  ${color(s.detail, DIM)}`);
    if (s.estimatedImpact) {
      console.log(`  ${color('Impact: ' + s.estimatedImpact, CYAN)}`);
    }
    if (s.learnMore) {
      console.log(`  ${color('→ ' + s.learnMore, DIM)}`);
    }
  }

  if (otherSuggestions.length > 0) {
    console.log('');
    console.log(`  ${color(`Other consistent findings (${otherSuggestions.length})`, DIM)}`);
    for (const { suggestion: s, runsFound } of otherSuggestions.slice(0, 5)) {
      const runBadge = sessions.length > 1 ? color(` ${runsFound}/${sessions.length}`, DIM) : '';
      console.log(`  ${color('·', DIM)} ${s.title}${runBadge}`);
    }
    if (otherSuggestions.length > 5) {
      console.log(`  ${color(`  …and ${otherSuggestions.length - 5} more. Run \`vitalsage analyze\` for full report.`, DIM)}`);
    }
  }

  // ── Single pooled analysis for the HTML report (richer context) ─────
  const allReports = await engine.analyze(sessions, { minSamples: 1 });
  const reportData = allReports.length > 0 ? allReports : [];

  const datestamp = new Date().toISOString().slice(0, 10);
  const outPath   = args.output ?? `report-${datestamp}.html`;
  const ext       = outPath.endsWith('.json') ? 'json' : 'html';
  const data      = ext === 'json' ? JSON.stringify(reportData, null, 2) : generateHtmlReport(reportData);
  await writeFile(outPath, data, 'utf8');
  printSuccess(`Report written to ${outPath}`);

  console.log('');
}
