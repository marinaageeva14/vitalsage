/**
 * `vitalsage capture <url>` — enriches a stored real-user interaction with a
 * live CDP flame-graph trace.
 *
 * Flow:
 *  1. Fetch real-user interactions from the example server (/api/interactions)
 *  2. Run one CDP trace session via PlaywrightSimulator
 *  3. Inject the trace data into the most-recent matching real session
 *  4. Run AnalysisEngine — CWV comes from real users, trace from CDP
 *  5. PATCH the server to persist the trace so /api/audit benefits too
 *  6. Display: real CWV → flame chart → combined findings
 */

import { writeFile } from 'node:fs/promises';
import type {
  TraceMetrics,
  NetworkProfile,
  ViewportProfile,
  SessionReport,
  Interaction,
} from '@vitalsage/types';
import type { Suggestion } from '@vitalsage/types';
import { AnalysisEngine, interactionsToSessions } from 'vitalsage-analysis';
import { printSuccess, printError, printInfo } from '../output/terminal.js';
import { browserConfig, type BrowserOpts } from '../utils/browser.js';

// ── ANSI helpers (duplicated from trace.ts to keep commands self-contained) ──

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function color(text: string, c: string): string { return `${c}${text}${RESET}`; }
function bar(pct: number, width = 28): string {
  const filled = Math.round(pct * width);
  return color('█'.repeat(filled) + '░'.repeat(width - filled), DIM);
}
function fmtMs(ms: number): string { return `${Math.round(ms).toLocaleString()}ms`; }

function traceColor(value: number, warn: number, crit: number): string {
  if (value >= crit) return RED;
  if (value >= warn) return YELLOW;
  return GREEN;
}

const CWV_THRESHOLDS = {
  LCP:  { good: 2500, poor: 4000  },
  FCP:  { good: 1800, poor: 3000  },
  TTFB: { good:  800, poor: 1800  },
  CLS:  { good:  0.1, poor: 0.25  },
  INP:  { good:  200, poor:  500  },
} as const;

function cwvColor(name: string, value: number): string {
  const t = CWV_THRESHOLDS[name as keyof typeof CWV_THRESHOLDS];
  if (!t) return DIM;
  if (value <= t.good) return GREEN;
  if (value <= t.poor) return YELLOW;
  return RED;
}

function divider(label?: string): void {
  const line = '━'.repeat(52);
  if (label) {
    console.log('');
    console.log(`${color(line.slice(0, 4), DIM)}  ${color(label, BOLD)}  ${color(line.slice(label.length + 6), DIM)}`);
  } else {
    console.log(color(line, DIM));
  }
}

// ── Real CWV display ──────────────────────────────────────────────────────────

function printRealCwv(sessions: SessionReport[]): void {
  divider('Real-User CWV  (p75)');

  const metrics = ['LCP', 'FCP', 'TTFB', 'CLS', 'INP'] as const;

  for (const name of metrics) {
    const vals = sessions
      .map(s => s.metrics[name]?.value)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);

    if (vals.length === 0) {
      console.log(`  ${name.padEnd(6)}  ${color('no data', DIM)}`);
      continue;
    }

    const p75idx = Math.floor(vals.length * 0.75);
    const p75    = vals[Math.min(p75idx, vals.length - 1)]!;
    const fmt    = name === 'CLS' ? p75.toFixed(3) : `${Math.round(p75).toLocaleString()}ms`;
    const c      = cwvColor(name, p75);

    console.log(`  ${color(name.padEnd(6), BOLD)}  ${color(fmt.padStart(10), c)}  ${color(`(${vals.length} sessions)`, DIM)}`);
  }
}

// ── Trace display (adapted from trace.ts) ─────────────────────────────────────

function printTraceSection(tm: TraceMetrics): void {
  divider('Main Thread Breakdown');

  const total = Math.max(tm.mainThreadWork, 1);
  const rows: Array<[string, number, number, number]> = [
    ['JS Execute', tm.scriptingTime,  500,  1500],
    ['JS Compile', tm.jsCompileTime,  200,   800],
    ['Rendering',  tm.renderingTime,  200,   800],
  ];

  for (const [label, value, warn, crit] of rows) {
    const c   = traceColor(value, warn, crit);
    const pct = Math.min(value / total, 1);
    console.log(`  ${color(label.padEnd(12), BOLD)}  ${bar(pct)}  ${color(fmtMs(value).padStart(8), c)}`);
  }

  const tbtColor = traceColor(tm.totalBlockingTime, 300, 600);
  console.log('');
  console.log(`  ${'TBT'.padEnd(12)}  ${color(fmtMs(tm.totalBlockingTime).padStart(8), tbtColor)}  ${color(`${tm.longTaskCount} long task(s)`, DIM)}`);

  if (tm.topFunctions && tm.topFunctions.length > 0) {
    console.log('');
    console.log(`  ${color('Flame Chart — Top Functions by Self Time', BOLD)}  ${color('(V8 CPU profiler)', DIM)}`);
    console.log(color('  ' + '─'.repeat(58), DIM));
    console.log(`  ${color('Self'.padStart(8), DIM)}  ${color('Total'.padStart(8), DIM)}  ${color('%'.padStart(4), DIM)}  ${color('Function', DIM)}`);
    console.log(color('  ' + '─'.repeat(58), DIM));

    const totalSelf = tm.topFunctions.reduce((s, f) => s + f.selfTime, 0);
    for (const fn of tm.topFunctions.slice(0, 12)) {
      const share    = totalSelf > 0 ? fn.selfTime / totalSelf : 0;
      const sc       = fn.selfTime >= 200 ? RED : fn.selfTime >= 50 ? YELLOW : DIM;
      const selfStr  = color(fmtMs(fn.selfTime).padStart(8), sc);
      const totalStr = color(fmtMs(fn.totalTime).padStart(8), DIM);
      const pctStr   = color(`${Math.round(share * 100)}%`.padStart(4), DIM);
      const fnName   = color(fn.functionName || '(anonymous)', fn.selfTime >= 100 ? BOLD : RESET);
      const src      = fn.url
        ? color(`  ${fn.url.replace(/^https?:\/\/[^/]+/, '') || fn.url}:${fn.lineNumber}`, DIM)
        : '';
      console.log(`  ${selfStr}  ${totalStr}  ${pctStr}  ${fnName}${src}`);
    }
  } else if (tm.topScripts && tm.topScripts.length > 0) {
    console.log('');
    console.log(`  ${color('JS Execution by Script', BOLD)}  ${color('(from CPU profiler)', DIM)}`);
    console.log(color('  ' + '─'.repeat(58), DIM));

    for (const sc of tm.topScripts) {
      const label    = sc.url
        ? sc.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || sc.url
        : color('(inline / anonymous)', DIM);
      const timeStr  = fmtMs(sc.time).padStart(8);
      const pctStr   = `${Math.round(sc.share * 100)}%`.padStart(5);
      const tc       = sc.time >= 300 ? (sc.time >= 800 ? RED : YELLOW) : GREEN;
      const miniBar  = bar(sc.share, 16);
      console.log(`  ${color(timeStr, tc)}  ${color(pctStr, DIM)}  ${miniBar}  ${label}`);
    }
  }
}

// ── Findings display ──────────────────────────────────────────────────────────

function printFindings(suggestions: Suggestion[], label: string): void {
  divider(`Findings  ${label}`);

  if (suggestions.length === 0) {
    console.log(`  ${color('✓ No issues detected', GREEN)}`);
    return;
  }

  const bySev = {
    critical: suggestions.filter(s => s.severity === 'critical'),
    warning:  suggestions.filter(s => s.severity === 'warning'),
    info:     suggestions.filter(s => s.severity === 'info'),
  };

  for (const [sev, items] of Object.entries(bySev)) {
    for (const s of items) {
      const sc  = sev === 'critical' ? RED : sev === 'warning' ? YELLOW : DIM;
      const tag = color(`[${sev.toUpperCase()}]`, sc);
      console.log('');
      console.log(`  ${tag}  ${color(s.title, BOLD)}`);
      console.log(`  ${color(s.detail, DIM)}`);
      if (s.estimatedImpact) console.log(`  ${color('↳ ' + s.estimatedImpact, CYAN)}`);
      if (s.learnMore)       console.log(`  ${color('→ ' + s.learnMore, DIM)}`);
    }
  }
}

// ── Server helpers ────────────────────────────────────────────────────────────

async function fetchInteractions(
  serverUrl: string,
  app:       string | undefined,
  url:       string,
): Promise<Interaction[]> {
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();

  const params = new URLSearchParams({ uri: path, full: '1', limit: '500', status: 'success' });
  if (app) params.set('app', app);

  const endpoint = `${serverUrl.replace(/\/$/, '')}/api/interactions?${params.toString()}`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json() as Array<{ interaction?: Interaction }>;
    return rows.flatMap(r => r.interaction ? [r.interaction] : []);
  } catch (err) {
    printError(`Could not fetch from server: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function patchTrace(
  serverUrl: string,
  id:        string,
  traceMetrics: TraceMetrics,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${serverUrl.replace(/\/$/, '')}/api/interaction/${id}/trace`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ traceMetrics }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── TraceMetrics averaging (same as trace.ts) ─────────────────────────────────

function averageTraceMetrics(sessions: SessionReport[]): TraceMetrics | undefined {
  const tms = sessions.map(s => s.page.traceMetrics).filter((t): t is TraceMetrics => t !== undefined);
  if (tms.length === 0) return undefined;

  const avg = (fn: (t: TraceMetrics) => number) =>
    tms.reduce((s, t) => s + fn(t), 0) / tms.length;

  const worst = tms.reduce((a, b) => a.totalBlockingTime >= b.totalBlockingTime ? a : b);

  const result: TraceMetrics = {
    totalBlockingTime: avg(t => t.totalBlockingTime),
    longTaskCount:     Math.round(avg(t => t.longTaskCount)),
    longTasks:         worst.longTasks,
    mainThreadWork:    avg(t => t.mainThreadWork),
    scriptingTime:     avg(t => t.scriptingTime),
    jsCompileTime:     avg(t => t.jsCompileTime),
    renderingTime:     avg(t => t.renderingTime),
    layoutCount:       Math.round(avg(t => t.layoutCount)),
    styleRecalcCount:  Math.round(avg(t => t.styleRecalcCount)),
    domNodes:          Math.round(avg(t => t.domNodes)),
    jsListeners:       Math.round(avg(t => t.jsListeners)),
    ...(tms.some(t => t.jsHeapUsed !== undefined)
      ? { jsHeapUsed: Math.round(avg(t => t.jsHeapUsed ?? 0)) }
      : {}),
    ...(tms.some(t => t.topScripts)
      ? { topScripts: worst.topScripts }
      : {}),
    ...(tms.some(t => t.topFunctions)
      ? { topFunctions: worst.topFunctions }
      : {}),
  };
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CaptureArgs extends BrowserOpts {
  url:        string;
  server?:    string;
  app?:       string;
  fullReport?: boolean;
  runs?:       number;
  network?:   string;
  viewport?:  string;
  output?:    string;
  aiProvider?: string;
  aiKey?:      string;
  aiModel?:    string;
  noServer?:  boolean;
}

export async function runCapture(args: CaptureArgs): Promise<void> {
  const { PlaywrightSimulator } = await import('vitalsage-simulator');
  const { generateHtmlReport }  = await import('vitalsage-analysis');

  const serverUrl  = args.server ?? 'http://localhost:3001';
  const fullReport = args.fullReport ?? false;
  const runs       = args.runs ?? 1;
  const app        = args.app;   // undefined → no app filter when fetching

  console.log('');
  console.log(`${color('━'.repeat(54), DIM)}`);
  console.log(`  ${color('vitalsage capture', MAGENTA)}  ${color(args.url, BOLD)}`);
  if (!args.noServer) {
    const appLabel = app ? color(`app: ${app}`, DIM) : color('all apps', DIM);
    console.log(`  ${color('Real-user data from', DIM)} ${color(serverUrl, CYAN)}  ${appLabel}`);
  }
  console.log(`${color('━'.repeat(54), DIM)}`);

  // ── 1. Fetch real interactions from server ──────────────────────
  let realSessions: SessionReport[] = [];

  if (!args.noServer) {
    printInfo(`Fetching real-user interactions from ${serverUrl}…`);
    const interactions = await fetchInteractions(serverUrl, app, args.url);

    if (interactions.length > 0) {
      realSessions = interactionsToSessions(interactions);
      printSuccess(`Loaded ${realSessions.length} real sessions for analysis`);
    } else {
      printInfo('No matching real-user data found — analysis will be trace-only');
    }
  }

  // ── 2. Capture CDP trace ────────────────────────────────────────
  printInfo(`Capturing trace${fullReport ? ' (full CPU profiler)' : ''}…`);

  const startMs = Date.now();

  // Suppress simulator internal logs during capture
  const origLog = console.log.bind(console);
  console.log = (...a: unknown[]) => {
    const msg = String(a[0] ?? '');
    if (!msg.includes('[VitalSage Simulator]')) origLog(...a);
  };

  let traceSessions: SessionReport[] = [];
  try {
    const simulator = new PlaywrightSimulator();
    traceSessions = await simulator.simulate({
      url:              args.url,
      runs,
      outputDir:        '.vitalsage-capture-tmp',
      concurrency:      1,
      captureTrace:     true,
      captureFullTrace: fullReport,
      networks:         [(args.network ?? '4g') as NetworkProfile],
      viewports:        [(args.viewport ?? 'desktop') as ViewportProfile],
      waitAfterLoad:    3000,
      delayBetweenRuns: 1500,
      ...browserConfig(args),
    });
  } finally {
    console.log = origLog;
  }

  if (traceSessions.length === 0) {
    printError('Trace capture failed — check the URL and try again');
    process.exit(1);
  }

  const captureMs = Date.now() - startMs;
  printSuccess(`Trace captured in ${(captureMs / 1000).toFixed(1)}s  (${traceSessions.length} run${traceSessions.length > 1 ? 's' : ''})`);

  const traceMetrics = averageTraceMetrics(traceSessions);

  // ── 3. Display real CWV (if available) ─────────────────────────
  if (realSessions.length > 0) {
    printRealCwv(realSessions);
  }

  // ── 4. Display trace breakdown ──────────────────────────────────
  if (traceMetrics) printTraceSection(traceMetrics);

  // ── 5. Combine and analyse ──────────────────────────────────────
  //
  // Strategy: inject the trace data into the most-recent real session so the
  // TraceAgent has traceMetrics to work with, while all CWV agents see the
  // full real-user distribution.  If there are no real sessions, fall back to
  // trace sessions only.
  let sessionsForAnalysis: SessionReport[];

  if (realSessions.length > 0 && traceMetrics) {
    // Sort real sessions newest-first; inject trace into the first one so
    // synthesizeContext() picks it as the representative page.
    const sorted = [...realSessions].sort((a, b) => b.timestamp - a.timestamp);
    const enrichedHead: SessionReport = {
      ...sorted[0]!,
      page: { ...sorted[0]!.page, traceMetrics },
    };
    sessionsForAnalysis = [enrichedHead, ...sorted.slice(1)];
  } else {
    sessionsForAnalysis = traceSessions;
  }

  const aiConfig = args.aiProvider && args.aiKey
    ? { provider: args.aiProvider as 'anthropic' | 'openai' | 'gemini', apiKey: args.aiKey, ...(args.aiModel ? { model: args.aiModel } : {}) }
    : undefined;

  const engine  = new AnalysisEngine({ ...(aiConfig ? { ai: aiConfig } : {}) });
  const reports = await engine.analyze(sessionsForAnalysis, { minSamples: 1 });

  const allSuggestions = reports.flatMap(r => r.suggestions);
  const label = realSessions.length > 0
    ? color(`real CWV × trace  ·  ${realSessions.length} real sessions`, DIM)
    : color('trace-only', DIM);

  printFindings(allSuggestions, label);

  // ── 6. Persist trace data back to server ────────────────────────
  if (!args.noServer && traceMetrics && realSessions.length > 0) {
    // Find the most recent matching interaction to enrich
    const newest = [...realSessions].sort((a, b) => b.timestamp - a.timestamp)[0];
    if (newest) {
      const patched = await patchTrace(serverUrl, newest.sessionId, traceMetrics);
      if (patched) {
        printSuccess(`Enriched interaction ${newest.sessionId} at ${serverUrl} — future /api/audit will include trace data`);
      }
    }
  }

  // ── 7. Save report ──────────────────────────────────────────────
  if (args.output || reports.length > 0) {
    const datestamp = new Date().toISOString().slice(0, 10);
    const outPath   = args.output ?? `capture-${datestamp}.html`;
    const ext       = outPath.endsWith('.json') ? 'json' : 'html';
    const data      = ext === 'json'
      ? JSON.stringify({ url: args.url, ...(app ? { app } : {}), traceMetrics, reports }, null, 2)
      : generateHtmlReport(reports);
    await writeFile(outPath, data, 'utf8');
    printSuccess(`Report saved to ${outPath}`);
  }

  console.log('');
}
