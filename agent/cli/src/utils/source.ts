/**
 * Source file utilities for the `vitalsage fix` command.
 *
 * readSourceFiles()  — walks a directory and returns file contents for the AI
 * applyPatches()     — applies search/replace patches to files and reports results
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, extname }            from 'node:path';
import type { FilePatch }                     from '../ai/fix-parser.js';

export interface SourceFile {
  path:    string;   // relative path from root
  content: string;
  bytes:   number;
}

export interface PatchResult {
  file:        string;
  description: string;
  applied:     boolean;
  reason?:     string;    // why it was skipped
}

const ALLOWED_EXTENSIONS = new Set([
  '.html', '.htm',
  '.css',
  '.js', '.mjs', '.cjs',
  '.ts', '.mts',
  '.jsx', '.tsx',
  '.vue', '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  '.nuxt', '.output', '.svelte-kit', 'coverage', '.cache',
]);

// Walk collects more files than the AI sees; the fixer ranks them by
// relevance to the finding and sends only the top slice.
const MAX_FILES          = 60;
const MAX_BYTES_PER_FILE = 25_000;   // 25 KB — keeps tokens manageable

export async function readSourceFiles(dir: string): Promise<SourceFile[]> {
  const results: SourceFile[] = [];
  await walk(dir, dir, results);
  return results;
}

async function walk(root: string, dir: string, out: SourceFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (out.length >= MAX_FILES) break;
    if (SKIP_DIRS.has(name)) continue;

    const full = join(dir, name);
    let s;
    try { s = await stat(full); } catch { continue; }

    if (s.isDirectory()) {
      await walk(root, full, out);
    } else if (s.isFile() && ALLOWED_EXTENSIONS.has(extname(name).toLowerCase())) {
      const bytes = s.size;
      let content: string;
      try {
        const raw = await readFile(full, 'utf8');
        content = bytes > MAX_BYTES_PER_FILE
          ? raw.slice(0, MAX_BYTES_PER_FILE) + '\n/* [truncated — file too large] */'
          : raw;
      } catch {
        continue;
      }
      out.push({ path: relative(root, full), content, bytes });
    }
  }
}

export async function applyPatches(
  sourceDir: string,
  patches:   FilePatch[],
): Promise<PatchResult[]> {
  const results: PatchResult[] = [];

  for (const patch of patches) {
    const fullPath = join(sourceDir, patch.file);

    let original: string;
    try {
      original = await readFile(fullPath, 'utf8');
    } catch {
      results.push({
        file:        patch.file,
        description: patch.description,
        applied:     false,
        reason:      `File not found: ${fullPath}`,
      });
      continue;
    }

    const occurrences = original.split(patch.search).length - 1;
    if (occurrences === 0) {
      results.push({
        file:        patch.file,
        description: patch.description,
        applied:     false,
        reason:      `Search string not found in ${patch.file}`,
      });
      continue;
    }
    if (occurrences > 1) {
      results.push({
        file:        patch.file,
        description: patch.description,
        applied:     false,
        reason:      `Search string matches ${occurrences} locations in ${patch.file} — ambiguous`,
      });
      continue;
    }

    // split/join = literal replacement. String.replace() would interpret
    // $-patterns ($&, $1…) in the AI-generated replacement text.
    const updated = original.split(patch.search).join(patch.replace);
    try {
      await writeFile(fullPath, updated, 'utf8');
      results.push({
        file:        patch.file,
        description: patch.description,
        applied:     true,
      });
    } catch (err) {
      results.push({
        file:        patch.file,
        description: patch.description,
        applied:     false,
        reason:      `Write failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}
