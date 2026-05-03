import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionReport } from '@vitalsage/types';

export async function loadSessionsFromDir(dirPath: string): Promise<SessionReport[]> {
  const files = await readdir(dirPath);
  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));

  const results = await Promise.allSettled(
    jsonFiles.map(async f => {
      const raw = await readFile(join(dirPath, f), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed['sessionId'] || !parsed['metrics'] || !parsed['device']) return null;
      return parsed as unknown as SessionReport;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<SessionReport | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((s): s is SessionReport => s !== null);
}
