import type { SessionReport, RouteConfig, AnalysisConfidence } from '@vitalsage/types';
import { CONFIDENCE_THRESHOLDS } from '@vitalsage/types';

export function groupSessionsByRoute(
  sessions: SessionReport[],
  routes: RouteConfig[],
): Map<string, SessionReport[]> {
  const groups = new Map<string, SessionReport[]>();

  for (const session of sessions) {
    // Use the pattern already attached to the session's route context
    const key = session.route.pattern;
    const existing = groups.get(key) ?? [];
    existing.push(session);
    groups.set(key, existing);
  }

  return groups;
}

export function computeConfidence(sampleSize: number): AnalysisConfidence {
  if (sampleSize < CONFIDENCE_THRESHOLDS.low)    return 'insufficient';
  if (sampleSize < CONFIDENCE_THRESHOLDS.medium) return 'low';
  if (sampleSize < CONFIDENCE_THRESHOLDS.high)   return 'medium';
  return 'high';
}
