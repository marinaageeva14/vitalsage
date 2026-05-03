/**
 * audit_route tool
 *
 * End-to-end performance audit for a single route.  Combines:
 *   1. Synthetic measurement (PlaywrightSimulator)
 *   2. Real-user data (from VitalSage server, optional)
 *   3. Analysis engine (all agents)
 *
 * Returns a self-contained RouteAudit with prioritised suggestions.
 */
import { z }                   from 'zod';
import { measurePage }         from './measure.js';
import { getRealUserData }     from './real-user.js';
import { AnalysisEngine }      from 'vitalsage-analysis';
import type { SessionReport, AnalysisReport } from '@vitalsage/types';

export const AuditInputSchema = z.object({
  url: z.string().url().describe('Route URL to audit'),
  runs: z.number().int().min(1).max(10).default(5)
    .describe('Number of synthetic runs. Default 5.'),
  serverUrl: z.string().url().optional()
    .describe(
      'VitalSage server URL (e.g. http://localhost:3001). ' +
      'When provided, real-user sessions are merged with synthetic sessions ' +
      'for a richer analysis.'
    ),
  app: z.string().optional()
    .describe('App name filter for real-user data.'),
  ai: z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini']),
    apiKey:   z.string(),
    model:    z.string().optional(),
  }).optional()
    .describe('AI provider for enhanced root-cause explanations.'),
  captureTrace: z.boolean().default(true)
    .describe('Capture CPU trace for deep script analysis. Default true.'),
});

export type AuditInput = z.infer<typeof AuditInputSchema>;

export interface RouteAudit {
  url:              string;
  syntheticCount:   number;
  realUserCount:    number;
  analyses:         AnalysisReport[];
  topSuggestions:   RouteAudit['analyses'][number]['suggestions'];
  durationMs:       number;
}

export async function auditRoute(input: AuditInput): Promise<RouteAudit> {
  const t0 = Date.now();

  // Run both in parallel when possible
  const [syntheticResult, realUserResult] = await Promise.all([
    measurePage({
      url:          input.url,
      runs:         input.runs,
      captureTrace: input.captureTrace,
      networks:     ['4g', '3g'],
      viewports:    ['desktop', 'mobile'],
    }),
    input.serverUrl
      ? getRealUserData({ serverUrl: input.serverUrl, app: input.app, limit: 2000 })
          .catch((err: unknown) => {
            console.warn('[VitalSage MCP] Could not fetch real-user data:', err);
            return null;
          })
      : Promise.resolve(null),
  ]);

  const allSessions: SessionReport[] = [
    ...syntheticResult.sessions,
    ...(realUserResult?.sessions ?? []),
  ];

  const engine = new AnalysisEngine({
    ...(input.ai ? { ai: input.ai } : {}),
  });

  const analyses = await engine.analyze(allSessions, { minSamples: 1 });

  // Collect top-5 suggestions across all routes, de-duplicated
  const seen = new Set<string>();
  const topSuggestions = analyses
    .flatMap(a => a.suggestions)
    .filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .slice(0, 5);

  return {
    url:            input.url,
    syntheticCount: syntheticResult.sessions.length,
    realUserCount:  realUserResult?.sessions.length ?? 0,
    analyses,
    topSuggestions,
    durationMs:     Date.now() - t0,
  };
}
