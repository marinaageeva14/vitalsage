import type { SessionReport } from '@vitalsage/types';

export function loadSessionsFromMemory(sessions: SessionReport[]): SessionReport[] {
  return sessions.filter(s => s.sessionId && s.metrics && s.device);
}
