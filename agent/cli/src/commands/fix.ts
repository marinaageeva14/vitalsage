/**
 * vitalsage fix
 *
 * Autonomous performance improvement loop:
 *
 *   Step 1 — audit_route:    measure the page + run all 9 agents
 *   Step 2 — inspect DOM:    confirm LCP element, blocking resources, CLS sources
 *   Step 3 — AI fix:         read source files, generate + apply patches
 *   Step 4 — compare:        re-measure against the original baseline
 *   Step 5 — loop or done:   if no improvement and retries remain, repeat
 *
 * --retries is REQUIRED (no default). The user must explicitly decide how many
 * AI+measure cycles to allow. Each cycle calls the AI provider and runs multiple
 * Playwright sessions, so token/time cost scales linearly with retries.
 */
import { PlaywrightSimulator }  from 'vitalsage-simulator';
import { AnalysisEngine, resolveProvider } from 'vitalsage-analysis';
import type { AIConfig, SessionReport }    from '@vitalsage/types';
import { inspectDom }           from '../utils/dom.js';
import { readSourceFiles, applyPatches } from '../utils/source.js';
import { generateFixes }        from '../ai/fixer.js';
import {
  printSuccess, printError, printWarning, printInfo,
} from '../output/terminal.js';

export interface FixArgs {
  url:        string;
  source:     string;         // path to source directory
  retries:    number;         // REQUIRED — no default
  aiProvider: string;
  aiKey:      string;
  aiModel?:   string;
  runs?:      number;         // synthetic runs per measurement (default 3)
  network?:   '4g' | '3g';
  viewport?:  'desktop' | 'mobile';
}

// ─── helpers ────────────────────────────────────────────────────────────────

const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function banner(msg: string): void {
  console.log(`\n${BOLD}${CYAN}${msg}${RESET}`);
}

function dim(msg: string): void {
  console.log(`${DIM}${msg}${RESET}`);
}

// p75 over an array of session metric values
function p75(values: number[]): number | null {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.ceil(sorted.length * 0.75) - 1]!;
}

function extractP75(sessions: SessionReport[], metric: 'LCP' | 'FCP' | 'CLS' | 'INP' | 'TTFB'): number | null {
  const vals = sessions
    .map(s => {
      const m = s.metrics[metric];
      if (!m || typeof m !== 'object') return null;
      return (m as { value?: number }).value ?? null;
    })
    .filter((v): v is number => v !== null);
  return p75(vals);
}

interface Snapshot {
  sessions: SessionReport[];
  lcp:      number | null;
  fcp:      number | null;
  cls:      number | null;
  inp:      number | null;
  ttfb:     number | null;
}

async function measure(
  url:      string,
  runs:     number,
  network:  '4g' | '3g',
  viewport: 'desktop' | 'mobile',
): Promise<Snapshot> {
  const sim      = new PlaywrightSimulator();
  const sessions = await sim.run({
    url,
    runs,
    networks:  [network],
    viewports: [viewport],
    captureTrace: false,
  });
  return {
    sessions,
    lcp:  extractP75(sessions, 'LCP'),
    fcp:  extractP75(sessions, 'FCP'),
    cls:  extractP75(sessions, 'CLS'),
    inp:  extractP75(sessions, 'INP'),
    ttfb: extractP75(sessions, 'TTFB'),
  };
}

function formatMetric(name: string, value: number | null): string {
  if (value === null) return '—';
  if (name === 'CLS') return value.toFixed(3);
  return `${Math.round(value)}ms`;
}

function printSnapshot(label: string, snap: Snapshot): void {
  dim(`  ${label}: LCP=${formatMetric('LCP', snap.lcp)}  FCP=${formatMetric('FCP', snap.fcp)}  CLS=${formatMetric('CLS', snap.cls)}  INP=${formatMetric('INP', snap.inp)}  TTFB=${formatMetric('TTFB', snap.ttfb)}`);
}

function isImprovement(before: Snapshot, after: Snapshot): boolean {
  // Count metrics that improved (lower = better for all CWV)
  let improved = 0;
  let degraded = 0;
  const pairs: Array<[number | null, number | null]> = [
    [before.lcp,  after.lcp],
    [before.fcp,  after.fcp],
    [before.cls,  after.cls],
    [before.inp,  after.inp],
    [before.ttfb, after.ttfb],
  ];
  for (const [b, a] of pairs) {
    if (b === null || a === null) continue;
    if (a < b * 0.97) improved++;   // >= 3% reduction counts
    if (a > b * 1.03) degraded++;
  }
  return improved > degraded && improved > 0;
}

// ─── main command ────────────────────────────────────────────────────────────

export async function runFix(args: FixArgs): Promise<void> {
  const runs     = args.runs     ?? 3;
  const network  = args.network  ?? '4g';
  const viewport = args.viewport ?? 'desktop';

  const aiConfig: AIConfig = {
    provider: args.aiProvider as AIConfig['provider'],
    apiKey:   args.aiKey,
    ...(args.aiModel ? { model: args.aiModel } : {}),
  };
  const ai = resolveProvider(aiConfig);

  const engine = new AnalysisEngine({ ai: aiConfig });

  // ── Step 0: Baseline measurement ──────────────────────────────────────────
  banner(`⏱  Capturing baseline — ${runs} run(s) on ${network} / ${viewport}`);
  const baseline = await measure(args.url, runs, network, viewport);
  printSuccess('Baseline captured');
  printSnapshot('Baseline', baseline);

  let previousSnapshot = baseline;
  let totalApplied = 0;

  // ── Loop ──────────────────────────────────────────────────────────────────
  for (let attempt = 1; attempt <= args.retries; attempt++) {
    banner(`\n🔄  Attempt ${attempt} / ${args.retries}`);

    // Step 1 — Audit
    printInfo('Step 1: Auditing page with all agents…');
    const reports = await engine.analyze(previousSnapshot.sessions);
    const allSuggestions = reports.flatMap(r => r.suggestions);

    if (allSuggestions.length === 0) {
      printSuccess('No suggestions — metrics are within acceptable ranges. Done!');
      break;
    }

    // Prioritise: critical first, then by confidence
    const sorted = [...allSuggestions].sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const sd = severityOrder[a.severity] - severityOrder[b.severity];
      return sd !== 0 ? sd : b.confidence - a.confidence;
    });

    const top = sorted[0]!;
    printInfo(`  Top issue: [${top.severity}] ${top.title}`);

    // Step 2 — Inspect DOM
    printInfo('Step 2: Inspecting live DOM…');
    let domFindings;
    try {
      domFindings = await inspectDom(args.url, network, viewport);
      printInfo(`  LCP element: ${domFindings.lcpElement ? `<${domFindings.lcpElement.tag}>` : 'not detected'}`);
      printInfo(`  Blocking resources: ${domFindings.blockingResources.length}`);
      printInfo(`  CLS contributors: ${domFindings.clsContributors.length}`);
    } catch (err) {
      printWarning(`DOM inspection failed: ${err instanceof Error ? err.message : String(err)}`);
      printInfo('  Continuing without DOM findings…');
      domFindings = {
        url: args.url,
        lcpElement: null,
        blockingResources: [],
        clsContributors: [],
        thirdPartyScripts: [],
        durationMs: 0,
      };
    }

    // Step 3 — Generate and apply fixes
    printInfo('Step 3: Reading source files…');
    const sourceFiles = await readSourceFiles(args.source);
    printInfo(`  Found ${sourceFiles.length} source file(s)`);

    if (sourceFiles.length === 0) {
      printWarning('No source files found in --source directory. Skipping fix step.');
      break;
    }

    printInfo('  Generating fix with AI…');
    let patches;
    try {
      patches = await generateFixes(top, domFindings, sourceFiles, ai);
    } catch (err) {
      printError(`AI fix generation failed: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }

    if (patches.length === 0) {
      printWarning('AI could not generate a fix for the identified issue.');
      printInfo('  This may happen when the problematic code is auto-generated or in node_modules.');
      break;
    }

    printInfo(`  Applying ${patches.length} patch(es)…`);
    const patchResults = await applyPatches(args.source, patches);

    let appliedCount = 0;
    for (const r of patchResults) {
      if (r.applied) {
        printSuccess(`  ✓ ${r.file} — ${r.description}`);
        appliedCount++;
      } else {
        printWarning(`  ✗ ${r.file} — ${r.reason ?? 'unknown reason'}`);
      }
    }
    totalApplied += appliedCount;

    if (appliedCount === 0) {
      printWarning('No patches could be applied. Check that --source points to the right directory.');
      break;
    }

    // Step 4 — Re-measure and compare
    printInfo(`Step 4: Re-measuring after fix (${runs} run(s))…`);
    const afterSnapshot = await measure(args.url, runs, network, viewport);

    printSnapshot('Before fix', previousSnapshot);
    printSnapshot('After fix ', afterSnapshot);

    // Step 5 — Decide whether to continue
    if (isImprovement(previousSnapshot, afterSnapshot)) {
      printSuccess(`✅  Improvement confirmed on attempt ${attempt}!`);
      printSnapshot('Baseline ', baseline);
      printSnapshot('Final    ', afterSnapshot);
      break;
    }

    if (attempt < args.retries) {
      printWarning(`No improvement detected on attempt ${attempt}. Retrying…`);
      previousSnapshot = afterSnapshot;   // update context for next attempt
    } else {
      printWarning(`No measurable improvement after ${args.retries} attempt(s).`);
      printInfo('Consider running with more --retries or inspecting the changes manually.');
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('');
  console.log(`${DIM}Total patches applied: ${totalApplied}${RESET}`);
  printSnapshot('Baseline', baseline);
}
