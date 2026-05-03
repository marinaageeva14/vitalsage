/**
 * measure_page tool
 *
 * Launches a headless Chromium browser, navigates to the target URL N times
 * across combinations of network profiles and viewport sizes, and returns the
 * aggregated Core Web Vitals + optional TraceMetrics for every run.
 *
 * Claude uses this to get a ground-truth synthetic performance baseline before
 * and after it edits code.
 */
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { PlaywrightSimulator }              from 'vitalsage-simulator';
import type { SessionReport, RawMetricValue } from '@vitalsage/types';

export const MeasureInputSchema = z.object({
  url: z.string().url().describe('Page URL to measure'),
  runs: z.number().int().min(1).max(20).default(3)
    .describe('Number of synthetic runs (1–20). Default 3.'),
  networks: z.array(z.enum(['wifi', '4g', '3g', '2g', 'slow-2g'])).optional()
    .describe('Network profiles to cycle through. Default ["4g","3g"].'),
  viewports: z.array(z.enum(['desktop', 'mobile', 'tablet'])).optional()
    .describe('Viewport profiles to cycle through. Default ["desktop","mobile"].'),
  captureTrace: z.boolean().default(false)
    .describe('Whether to capture V8 CPU profile + DOM/JS heap metrics (slower).'),
  routes: z.array(z.string()).optional()
    .describe('Additional route paths to visit on the same origin (e.g. ["/about", "/blog"]).'),
});

export type MeasureInput = z.infer<typeof MeasureInputSchema>;

export interface MeasureOutput {
  sessions:     SessionReport[];
  summary:      RouteSummary[];
  durationMs:   number;
}

interface RouteSummary {
  route:       string;
  runCount:    number;
  lcp_p75:     number | null;
  cls_p75:     number | null;
  inp_p75:     number | null;
  ttfb_p75:    number | null;
  fcp_p75:     number | null;
}

function p75(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx    = Math.ceil(sorted.length * 0.75) - 1;
  return Math.round(sorted[Math.max(0, idx)]!);
}

export async function measurePage(input: MeasureInput): Promise<MeasureOutput> {
  const start     = Date.now();
  const outputDir = join(tmpdir(), `vitalsage-mcp-${Date.now()}`);
  const sim       = new PlaywrightSimulator();

  const sessions = await sim.simulate({
    url:          input.url,
    runs:         input.runs,
    networks:     input.networks  ?? ['4g', '3g'],
    viewports:    input.viewports ?? ['desktop', 'mobile'],
    routes:       input.routes,
    captureTrace: input.captureTrace,
    outputDir,
    waitAfterLoad: 2000,
    concurrency:   2,
  });

  // Group by route and compute p75 summaries
  const byRoute = new Map<string, SessionReport[]>();
  for (const s of sessions) {
    const key = s.route.path;
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(s);
  }

  const summary: RouteSummary[] = [];
  for (const [route, rs] of byRoute) {
    const val = (m: RawMetricValue | undefined) => m?.value;
    summary.push({
      route,
      runCount: rs.length,
      lcp_p75:  p75(rs.map(s => val(s.metrics.LCP )).filter((v): v is number => v != null && v > 0)),
      cls_p75:  p75(rs.map(s => val(s.metrics.CLS )).filter((v): v is number => v != null && v >= 0)),
      inp_p75:  p75(rs.map(s => val(s.metrics.INP )).filter((v): v is number => v != null && v > 0)),
      ttfb_p75: p75(rs.map(s => val(s.metrics.TTFB)).filter((v): v is number => v != null && v > 0)),
      fcp_p75:  p75(rs.map(s => val(s.metrics.FCP )).filter((v): v is number => v != null && v > 0)),
    });
  }

  return { sessions, summary, durationMs: Date.now() - start };
}
