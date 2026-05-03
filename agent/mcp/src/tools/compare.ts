/**
 * compare_performance tool
 *
 * Measures the page twice (or uses a provided baseline) and returns a
 * structured diff showing how each Core Web Vital changed.  Claude uses this
 * after applying a code fix to verify the improvement is real.
 */
import { z }          from 'zod';
import { measurePage } from './measure.js';
import type { SessionReport, RawMetricValue } from '@vitalsage/types';

export const CompareInputSchema = z.object({
  url: z.string().url().describe('Page URL to measure'),
  runs: z.number().int().min(1).max(10).default(3)
    .describe('Runs per measurement pass. Default 3.'),
  networks: z.array(z.enum(['wifi', '4g', '3g', '2g', 'slow-2g'])).optional(),
  viewports: z.array(z.enum(['desktop', 'mobile', 'tablet'])).optional(),
  baseline: z.array(z.record(z.unknown())).optional()
    .describe(
      'Pre-existing baseline sessions (from a previous measure_page call). ' +
      'When provided, only one new measurement pass is done and the delta is ' +
      'computed against this baseline instead of re-running twice.'
    ),
});

export type CompareInput = z.infer<typeof CompareInputSchema>;

interface MetricDiff {
  metric:   string;
  before:   number | null;
  after:    number | null;
  delta:    number | null;
  deltasPct: number | null;
  improved: boolean | null;
}

export interface CompareOutput {
  diffs:      MetricDiff[];
  summary:    string;
  durationMs: number;
}

function p75(sessions: SessionReport[], key: keyof SessionReport['metrics']): number | null {
  const values = sessions
    .map(s => (s.metrics[key] as RawMetricValue | undefined)?.value)
    .filter((v): v is number => v != null && v > 0);
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.75) - 1]!;
}

// Lower = better for all CWV metrics
const LOWER_IS_BETTER = new Set(['LCP', 'CLS', 'INP', 'TTFB', 'FCP']);

export async function comparePerformance(input: CompareInput): Promise<CompareOutput> {
  const t0      = Date.now();
  const opts    = { runs: input.runs, networks: input.networks, viewports: input.viewports };

  let beforeSessions: SessionReport[];
  let afterSessions:  SessionReport[];

  if (input.baseline) {
    beforeSessions = input.baseline as SessionReport[];
    afterSessions  = (await measurePage({ url: input.url, captureTrace: false, ...opts })).sessions;
  } else {
    // Two sequential passes
    beforeSessions = (await measurePage({ url: input.url, captureTrace: false, ...opts })).sessions;
    afterSessions  = (await measurePage({ url: input.url, captureTrace: false, ...opts })).sessions;
  }

  const metrics = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'] as const;
  const diffs: MetricDiff[] = metrics.map(m => {
    const before = p75(beforeSessions, m);
    const after  = p75(afterSessions,  m);
    const delta  = (before != null && after != null) ? after - before : null;
    const pct    = (delta != null && before != null && before > 0)
      ? Math.round((delta / before) * 100)
      : null;
    const improved = delta == null ? null
      : LOWER_IS_BETTER.has(m) ? delta < 0 : delta > 0;

    return { metric: m, before, after, delta, deltasPct: pct, improved };
  });

  const improved = diffs.filter(d => d.improved === true).length;
  const degraded = diffs.filter(d => d.improved === false).length;
  const summary  = improved === 0 && degraded === 0
    ? 'No measurable change across Core Web Vitals.'
    : `${improved} metric(s) improved, ${degraded} degraded. ` +
      diffs
        .filter(d => d.delta != null)
        .map(d => `${d.metric}: ${d.before}→${d.after} (${d.deltasPct != null ? (d.deltasPct > 0 ? '+' : '') + d.deltasPct + '%' : 'N/A'})`)
        .join(', ');

  return { diffs, summary, durationMs: Date.now() - t0 };
}
