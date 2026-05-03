/**
 * get_real_user_data tool
 *
 * Fetches real-user Interaction records from a running VitalSage example server,
 * then converts them to SessionReport objects for use with analyze_performance.
 *
 * The server exposes:
 *   GET /api/interactions?app=vanilla&limit=500
 *
 * Responses are raw Interaction rows; we convert them to SessionReports using
 * interactionsToSessions() so the rest of the pipeline (analysis engine, MCP
 * compare/audit tools) works with a uniform type.
 */
import { z }                          from 'zod';
import { interactionsToSessions }     from 'vitalsage-analysis';
import type { SessionReport, Interaction } from '@vitalsage/types';

export const RealUserInputSchema = z.object({
  serverUrl: z.string().url()
    .describe('Base URL of the VitalSage example server (e.g. http://localhost:3001).'),
  app: z.string().optional()
    .describe('Filter by app name (e.g. "vanilla", "react"). Omit to fetch all apps.'),
  route: z.string().optional()
    .describe('Filter by route path prefix (e.g. "/dashboard").'),
  limit: z.number().int().min(1).max(10000).default(500)
    .describe('Maximum number of interactions to return. Default 500.'),
  since: z.number().optional()
    .describe('Unix timestamp (ms). Only return interactions after this time.'),
});

export type RealUserInput = z.infer<typeof RealUserInputSchema>;

export interface RealUserOutput {
  sessions:  SessionReport[];
  total:     number;
  routes:    string[];
}

export async function getRealUserData(input: RealUserInput): Promise<RealUserOutput> {
  const params = new URLSearchParams();
  if (input.app)   params.set('app',   input.app);
  if (input.route) params.set('uri',   input.route);   // server param is "uri"
  params.set('limit', String(input.limit));
  params.set('full',  '1');                             // include full interaction JSON

  const base = input.serverUrl.replace(/\/$/, '');
  const url  = `${base}/api/interactions?${params}`;
  const res  = await fetch(url);

  if (!res.ok) {
    throw new Error(`VitalSage server responded with ${res.status}: ${await res.text()}`);
  }

  // Server returns flat rows with an optional nested `interaction` field when ?full=1
  type Row = { interaction?: Interaction; timestamp?: number | null };
  const rows = (await res.json()) as Row[];

  // Extract full Interaction objects (full=1 guarantees the field is present)
  let interactions: Interaction[] = rows
    .map(r => r.interaction)
    .filter((x): x is Interaction => x != null);

  // Client-side time filtering
  if (input.since) {
    const cutoff = input.since;
    interactions = interactions.filter(i => (i.timestamp ?? 0) >= cutoff);
  }

  const sessions = interactionsToSessions(interactions);
  const routes   = [...new Set(sessions.map(s => s.route?.path ?? s.url))];

  return {
    sessions,
    total:  sessions.length,
    routes,
  };
}
