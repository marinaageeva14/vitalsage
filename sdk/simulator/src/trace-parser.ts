/**
 * Parses raw CDP trace events (from Tracing.dataCollected) into structured data.
 *
 * Chrome DevTools Performance tab uses the exact same underlying data —
 * `Tracing.start` / `Tracing.stop` produces the same JSON that DevTools exports
 * when you click "Save profile". This module extracts the subset most useful
 * for automated performance analysis.
 */

import type { ScriptActivity, FunctionProfile } from '@vitalsage/types';

// ── Types ────────────────────────────────────────────────────────────────────

/** A single event from a CDP Tracing.dataCollected chunk. */
export interface RawTraceEvent {
  pid:   number;
  tid:   number;
  /** Phase: 'X' = complete, 'B'/'E' = begin/end, 'M' = metadata, 'i' = instant, etc. */
  ph:    string;
  cat:   string;
  name:  string;
  /** Timestamp in microseconds from an arbitrary epoch. */
  ts:    number;
  /** Duration in microseconds (only present for complete 'X' events). */
  dur?:  number;
  args?: Record<string, unknown>;
}

// ── Main-thread detection ─────────────────────────────────────────────────────

/**
 * Returns the { pid, tid } of the renderer main thread.
 *
 * Chrome names the renderer main thread "CrRendererMain" in a metadata event.
 * If that event isn't present (e.g. lightweight trace without metadata) we fall
 * back to the thread that has the most EvaluateScript events.
 */
function findMainThread(events: RawTraceEvent[]): { pid: number; tid: number } | null {
  // Primary: metadata thread_name event
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') {
      const name = (e.args as { name?: string } | undefined)?.name;
      if (name === 'CrRendererMain') return { pid: e.pid, tid: e.tid };
    }
  }

  // Fallback: thread with the most EvaluateScript complete events
  const counts = new Map<string, { pid: number; tid: number; n: number }>();
  for (const e of events) {
    if (e.name === 'EvaluateScript' && e.ph === 'X') {
      const key = `${e.pid}:${e.tid}`;
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { pid: e.pid, tid: e.tid, n: 1 });
    }
  }

  let best: { pid: number; tid: number; n: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }

  return best ? { pid: best.pid, tid: best.tid } : null;
}

// ── Per-script attribution ────────────────────────────────────────────────────

/**
 * Extracts per-script execution time from `EvaluateScript` complete events on
 * the main thread.
 *
 * EvaluateScript events carry `args.data.url` (the script URL) and `dur`
 * (execution time in microseconds). We sum durations per URL and return the
 * top-N scripts sorted by time descending.
 *
 * Note: nested EvaluateScript events (dynamic imports inside scripts) can lead
 * to double-counting. To avoid that, we only count events that are not fully
 * contained within another EvaluateScript event.
 */
export function parseTopScripts(
  events:  RawTraceEvent[],
  topN:    number = 10,
): ScriptActivity[] {
  const thread = findMainThread(events);
  if (!thread) return [];

  const { pid, tid } = thread;

  // Collect EvaluateScript events on the main thread, sorted by start time.
  const evalEvents = events
    .filter(e => e.pid === pid && e.tid === tid && e.name === 'EvaluateScript' && e.ph === 'X' && (e.dur ?? 0) > 0)
    .sort((a, b) => a.ts - b.ts);

  if (evalEvents.length === 0) return [];

  // Remove events that are fully contained within a previous EvaluateScript
  // (dynamic import, eval inside a script) to avoid double-counting.
  const topLevel: RawTraceEvent[] = [];
  let maxEnd = -Infinity;
  for (const e of evalEvents) {
    const end = e.ts + (e.dur ?? 0);
    if (e.ts >= maxEnd) {
      topLevel.push(e);
      maxEnd = end;
    }
    // If this event starts inside the previous but extends further, extend the window.
    else if (end > maxEnd) {
      maxEnd = end;
    }
  }

  // Sum durations per URL (µs → ms)
  const urlTime = new Map<string, number>();
  for (const e of topLevel) {
    const data = (e.args as { data?: { url?: string } } | undefined)?.data;
    const url  = data?.url?.trim() ?? '';
    urlTime.set(url, (urlTime.get(url) ?? 0) + (e.dur ?? 0));
  }

  const totalUs = Array.from(urlTime.values()).reduce((s, v) => s + v, 0);
  if (totalUs === 0) return [];

  return Array.from(urlTime.entries())
    .map(([url, timeUs]) => ({
      url,
      time:  Math.round(timeUs / 1000),
      share: timeUs / totalUs,
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, topN);
}

// ── CPU profile parsing ───────────────────────────────────────────────────────

/**
 * Internal shapes from a V8 CpuProfile event / Profiler.stop() result.
 * https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile
 */
interface CpuProfileNode {
  id:         number;
  callFrame:  { functionName: string; url: string; lineNumber: number; columnNumber: number };
  hitCount?:  number;
  children?:  number[];
}

export interface CpuProfileData {
  nodes:       CpuProfileNode[];
  startTime:   number;
  endTime:     number;
  samples?:    number[];
  timeDeltas?: number[];
}

// ── Shared profile math ───────────────────────────────────────────────────────

/**
 * Computes self-time and total-time maps from a CPUProfile's samples + timeDeltas.
 * Returns { selfTimeUs, totalTimeUs, nodeMap }.
 */
function computeProfileTimes(profileData: CpuProfileData): {
  nodeMap:     Map<number, CpuProfileNode>;
  selfTimeUs:  Map<number, number>;
  totalTimeUs: Map<number, number>;
} {
  const { nodes, samples = [], timeDeltas = [] } = profileData;

  const nodeMap = new Map<number, CpuProfileNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Self time: each sample attributes its timeDelta to the leaf node.
  const selfTimeUs = new Map<number, number>();
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i]!;
    const delta  = timeDeltas[i] ?? 0;
    selfTimeUs.set(nodeId, (selfTimeUs.get(nodeId) ?? 0) + delta);
  }

  // Total time: self + recursive sum of children (memoized).
  const totalTimeUs = new Map<number, number>();
  function getTotalTime(nodeId: number): number {
    if (totalTimeUs.has(nodeId)) return totalTimeUs.get(nodeId)!;
    const node     = nodeMap.get(nodeId);
    const self     = selfTimeUs.get(nodeId) ?? 0;
    const children = (node?.children ?? []).reduce((s, cid) => s + getTotalTime(cid), 0);
    const total    = self + children;
    totalTimeUs.set(nodeId, total);
    return total;
  }
  for (const n of nodes) getTotalTime(n.id);

  return { nodeMap, selfTimeUs, totalTimeUs };
}

// ── Functions from direct Profiler.stop() result ──────────────────────────────

/**
 * Parses a `CpuProfileData` object returned by `Profiler.stop()` into a ranked
 * list of `FunctionProfile` entries sorted by self time descending.
 *
 * Use this instead of `parseCpuProfile(traceEvents)` when using the CDP
 * `Profiler` domain directly (which works in Playwright, unlike `Tracing`).
 */
export function parseFunctionsFromProfile(
  profileData: CpuProfileData,
  topN:        number = 25,
): FunctionProfile[] {
  if (!profileData.nodes.length) return [];

  const { nodes, samples = [] } = profileData;
  const { selfTimeUs, totalTimeUs } = computeProfileTimes(profileData);

  const dedupKey = (n: CpuProfileNode) =>
    `${n.callFrame.url}::${n.callFrame.lineNumber}::${n.callFrame.functionName}`;

  const merged = new Map<string, { node: CpuProfileNode; selfUs: number; totalUs: number; sampleCount: number }>();
  for (const n of nodes) {
    const fn = n.callFrame.functionName;
    if (fn === '(idle)' || fn === '(program)' || fn === '(garbage collector)') continue;
    if (!n.callFrame.url && !fn) continue;

    const key   = dedupKey(n);
    const self  = selfTimeUs.get(n.id)  ?? 0;
    const total = totalTimeUs.get(n.id) ?? 0;
    const sc    = samples.filter(s => s === n.id).length;

    const existing = merged.get(key);
    if (existing) {
      existing.selfUs     += self;
      existing.totalUs    += total;
      existing.sampleCount += sc;
    } else {
      merged.set(key, { node: n, selfUs: self, totalUs: total, sampleCount: sc });
    }
  }

  return Array.from(merged.values())
    .filter(e => e.selfUs > 0 || e.totalUs > 0)
    .map(e => ({
      functionName: e.node.callFrame.functionName || '(anonymous)',
      url:          e.node.callFrame.url,
      lineNumber:   e.node.callFrame.lineNumber + 1,
      selfTime:     Math.round(e.selfUs  / 1000),
      totalTime:    Math.round(e.totalUs / 1000),
      sampleCount:  e.sampleCount,
    }))
    .sort((a, b) => b.selfTime - a.selfTime)
    .slice(0, topN);
}

/**
 * Derives per-script CPU time from a `CpuProfileData` by grouping node self
 * times by URL. More accurate than EvaluateScript trace events because it
 * measures actual CPU samples rather than wall-clock event durations.
 */
export function parseScriptsFromProfile(
  profileData: CpuProfileData,
  topN:        number = 10,
): ScriptActivity[] {
  if (!profileData.nodes.length) return [];

  const { nodes } = profileData;
  const { selfTimeUs } = computeProfileTimes(profileData);

  // Sum self time per URL (skip V8 internals and empty URLs)
  const urlTime = new Map<string, number>();
  for (const n of nodes) {
    const url  = n.callFrame.url?.trim() ?? '';
    if (!url) continue;
    const fn = n.callFrame.functionName;
    if (fn === '(idle)' || fn === '(program)' || fn === '(garbage collector)') continue;

    const self = selfTimeUs.get(n.id) ?? 0;
    if (self > 0) urlTime.set(url, (urlTime.get(url) ?? 0) + self);
  }

  const totalUs = Array.from(urlTime.values()).reduce((s, v) => s + v, 0);
  if (totalUs === 0) return [];

  return Array.from(urlTime.entries())
    .map(([url, timeUs]) => ({
      url,
      time:  Math.round(timeUs / 1000),
      share: timeUs / totalUs,
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, topN);
}

// ── Legacy: parse from raw trace events ──────────────────────────────────────

/**
 * @deprecated Tracing.start/stop is blocked by Playwright's CDP abstraction.
 * Use `parseFunctionsFromProfile` with `Profiler.stop()` instead.
 *
 * Kept for reference — parses a V8 CpuProfile embedded in trace events.
 */
export function parseCpuProfile(
  events: RawTraceEvent[],
  topN:   number = 25,
): FunctionProfile[] {
  let profileData: CpuProfileData | undefined;
  for (const e of events) {
    if (e.name === 'CpuProfile' && e.args) {
      const data = (e.args as { data?: { cpuProfile?: CpuProfileData } }).data;
      if (data?.cpuProfile?.nodes) { profileData = data.cpuProfile; break; }
    }
    if (e.name === 'Profile' && e.args) {
      const data = (e.args as { data?: CpuProfileData }).data;
      if (data?.nodes) { profileData = data; break; }
    }
  }
  if (!profileData) return [];
  return parseFunctionsFromProfile(profileData, topN);
}
