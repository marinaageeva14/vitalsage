import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSessionsFromDir } from '../../../src/loaders/file.js';
import { buildMockSession } from '../../fixtures/builders.js';

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `vitalsage-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadSessionsFromDir', () => {
  it('loads valid session JSON files', async () => {
    const session = buildMockSession();
    await writeFile(join(dir, 'session-1.json'), JSON.stringify(session));
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe(session.sessionId);
  });

  it('loads multiple session files', async () => {
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dir, `session-${i}.json`), JSON.stringify(buildMockSession()));
    }
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toHaveLength(3);
  });

  it('ignores files starting with dot', async () => {
    await writeFile(join(dir, '.hidden.json'), JSON.stringify(buildMockSession()));
    await writeFile(join(dir, 'session-1.json'), JSON.stringify(buildMockSession()));
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toHaveLength(1);
  });

  it('ignores non-JSON files', async () => {
    await writeFile(join(dir, 'session.txt'), 'not json');
    await writeFile(join(dir, 'session-1.json'), JSON.stringify(buildMockSession()));
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toHaveLength(1);
  });

  it('ignores malformed JSON silently', async () => {
    await writeFile(join(dir, 'bad.json'), '{broken json');
    await writeFile(join(dir, 'good.json'), JSON.stringify(buildMockSession()));
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toHaveLength(1);
  });

  it('ignores objects missing required fields', async () => {
    await writeFile(join(dir, 'incomplete.json'), JSON.stringify({ foo: 'bar' }));
    await writeFile(join(dir, 'complete.json'), JSON.stringify(buildMockSession()));
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toHaveLength(1);
  });

  it('returns empty array for empty directory', async () => {
    const sessions = await loadSessionsFromDir(dir);
    expect(sessions).toEqual([]);
  });
});
