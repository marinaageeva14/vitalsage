/**
 * analyze_performance tool
 *
 * Runs the VitalSage analysis engine over an array of SessionReports and
 * returns an array of AnalysisReports — one per route — with ranked
 * suggestions, metric distributions, and (optionally) AI-enhanced diagnoses.
 */
import { z }                   from 'zod';
import { AnalysisEngine }      from 'vitalsage-analysis';
import type { SessionReport, AnalysisReport } from '@vitalsage/types';

export const AnalyzeInputSchema = z.object({
  sessions: z.array(z.record(z.unknown()))
    .describe('Array of SessionReport objects (from measure_page or get_real_user_data).'),
  minSamples: z.number().int().min(1).default(1)
    .describe('Minimum sessions required per route. Default 1 (good for synthetic runs).'),
  ai: z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini']),
    apiKey:   z.string(),
    model:    z.string().optional(),
  }).optional()
    .describe('AI provider config to get enhanced root-cause explanations.'),
  agents: z.array(z.enum([
    'lcp', 'cls', 'inp', 'ttfb', 'render-block',
    'resource-hint', 'image', 'font', 'trace',
  ])).optional()
    .describe('Specific agents to run. Omit for all agents.'),
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

export async function analyzePerformance(input: AnalyzeInput): Promise<AnalysisReport[]> {
  const engine = new AnalysisEngine({
    ...(input.ai ? { ai: input.ai } : {}),
    ...(input.agents ? { agents: input.agents as AnalyzeInput['agents'] } : {}),
  });

  return engine.analyze(
    input.sessions as SessionReport[],
    { minSamples: input.minSamples },
  );
}
