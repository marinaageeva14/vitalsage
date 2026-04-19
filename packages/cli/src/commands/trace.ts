import { writeFile }  from 'node:fs/promises';
import type { TraceMetrics, NetworkProfile, ViewportProfile } from '@vitalsage/types';
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

function printTraceMetrics(tm: TraceMetrics): void {
  console.log('');
  console.log(color('━'.repeat(50), DIM));
  console.log(`  ${color('Main Thread Breakdown', BOLD)}`);
  console.log(color('━'.repeat(50), DIM));

  const total = Math.max(tm.mainThreadWork, 1);

  const rows: Array<[string, number, string, number, number]> = [
    ['Scripting',  tm.scriptingTime,  'ms', 500,  1500],
    ['Rendering',  tm.renderingTime,  'ms', 200,  800],
    ['Painting',   tm.paintingTime,   'ms', 100,  400],
  ];

  for (const [label, value, , warn, crit] of rows) {
    const c   = traceColor(value, warn, crit);
    const pct = Math.min(value / total, 1);
    const pad = ' '.repeat(Math.max(0, 12 - label.length));
    console.log(`  ${color(label, BOLD)}${pad}  ${bar(pct)}  ${color(fmtMs(value).padStart(8), c)}`);
  }

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
    console.log(`  ${color('Top Long Tasks', BOLD)}`);
    console.log(color('─'.repeat(50), DIM));
    const top = tm.longTasks.slice(0, 5);
    for (const t of top) {
      const dColor = t.duration >= 200 ? RED : YELLOW;
      console.log(`  ${color(fmtMs(t.duration).padStart(8), dColor)}  ${color(`blocking: ${fmtMs(t.blocking)}`, DIM)}  ${color(`@ ${fmtMs(t.startTime)}`, DIM)}`);
    }
  }
}

export interface TraceArgs {
  url:       string;
  runs:      number;
  network:   string;
  viewport:  string;
  output?:   string;
  aiProvider?: string;
  aiKey?:    string;
  aiModel?:  string;
}

export async function runTrace(args: TraceArgs): Promise<void> {
  const { PlaywrightSimulator } = await import('vitalsage-simulator');
  const { AnalysisEngine, generateHtmlReport } = await import('vitalsage-analysis');

  printInfo(`Capturing performance trace for ${color(args.url, CYAN)}`);
  printInfo(`${args.runs} run(s) · network: ${args.network} · viewport: ${args.viewport}`);

  const origLog = console.log.bind(console);
  console.log   = (...a: unknown[]) => {
    const msg = String(a[0] ?? '');
    if (!msg.includes('[VitalSage Simulator]')) origLog(...a);
  };

  let sessions;
  try {
    const simulator = new PlaywrightSimulator();
    sessions = await simulator.simulate({
      url:          args.url,
      runs:         args.runs,
      outputDir:    '.vitalsage-trace-tmp',
      concurrency:  1,
      captureTrace: true,
      networks:     [args.network as NetworkProfile],
      viewports:    [args.viewport as ViewportProfile],
      waitAfterLoad: 3000,
    });
  } finally {
    console.log = origLog;
  }

  if (sessions.length === 0) {
    printError('No sessions collected — check the URL and try again');
    process.exit(1);
  }

  printSuccess(`Captured ${sessions.length} session(s)`);

  // Show raw trace metrics from the representative session
  const traceSession = sessions.find(s => s.page.traceMetrics);
  if (traceSession?.page.traceMetrics) {
    printTraceMetrics(traceSession.page.traceMetrics);
  }

  // Run analysis with minSamples: 1 to bypass the 50-session gate
  const aiConfig = args.aiProvider && args.aiKey
    ? { provider: args.aiProvider as 'anthropic' | 'openai' | 'gemini', apiKey: args.aiKey, ...(args.aiModel ? { model: args.aiModel } : {}) }
    : undefined;

  const engine  = new AnalysisEngine({ ...(aiConfig ? { ai: aiConfig } : {}) });
  const reports = await engine.analyze(sessions, { minSamples: 1 });

  if (reports.length === 0) {
    printInfo('No analysis reports generated');
    return;
  }

  const report = reports[0]!;
  const traceSuggestions = report.suggestions.filter(s => s.agent === 'trace');
  const otherSuggestions = report.suggestions.filter(s => s.agent !== 'trace');

  console.log('');
  console.log(color('━'.repeat(50), DIM));
  console.log(`  ${color('Trace Analysis Suggestions', BOLD)}`);
  console.log(color('━'.repeat(50), DIM));

  if (traceSuggestions.length === 0 && otherSuggestions.length === 0) {
    console.log(`  ${color('No issues detected in this trace', GREEN)}`);
  }

  for (const s of traceSuggestions) {
    const sc  = s.severity === 'critical' ? RED : YELLOW;
    const tag = color(`[${s.severity.toUpperCase()}]`, sc);
    console.log('');
    console.log(`  ${tag} ${color(s.title, BOLD)}`);
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
    console.log(`  ${color(`Other suggestions (${otherSuggestions.length})`, DIM)}`);
    for (const s of otherSuggestions.slice(0, 5)) {
      console.log(`  ${color('·', DIM)} ${s.title}`);
    }
    if (otherSuggestions.length > 5) {
      console.log(`  ${color(`  …and ${otherSuggestions.length - 5} more. Run \`vitalsage analyze\` for full report.`, DIM)}`);
    }
  }

  if (args.output) {
    const ext  = args.output.endsWith('.json') ? 'json' : 'html';
    const data = ext === 'json' ? JSON.stringify(reports, null, 2) : generateHtmlReport(reports);
    await writeFile(args.output, data, 'utf8');
    printSuccess(`Report written to ${args.output}`);
  }

  console.log('');
}
