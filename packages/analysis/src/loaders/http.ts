import type { SessionReport } from '@vitalsage/types';

export async function loadSessionsFromUrl(url: string, headers?: Record<string, string>): Promise<SessionReport[]> {
  const res = await fetch(url, { ...(headers ? { headers } : {}) });
  if (!res.ok) {
    throw new Error(`HTTP loader: request failed with status ${res.status}`);
  }

  const data = await res.json() as unknown;
  const items = Array.isArray(data) ? data : [data];

  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter(item => item['sessionId'] && item['metrics'] && item['device'])
    .map(item => item as unknown as SessionReport);
}
