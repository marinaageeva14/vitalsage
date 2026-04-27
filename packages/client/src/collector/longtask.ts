/**
 * LongTaskCollector — populates TraceMetrics from browser PerformanceObserver APIs.
 *
 * No CDP required. Two entry types are used when available:
 *
 *   longtask            Chrome 58+, Firefox 82+, Edge 79+
 *     → longTasks[], longTaskCount, totalBlockingTime (fallback), mainThreadWork (fallback)
 *
 *   long-animation-frame (LoAF)  Chrome 123+
 *     → totalBlockingTime (accurate), mainThreadWork, scriptingTime, renderingTime,
 *       topScripts (grouped by sourceURL from PerformanceScriptTiming)
 *
 * Fields that require CDP trace events are set to 0:
 *   jsCompileTime, layoutCount, styleRecalcCount, jsListeners
 * These values never produce false positives because all TraceAgent rules check `> threshold`.
 */

import type { TraceMetrics, LongTask, ScriptActivity } from '@vitalsage/types';

// ── LoAF shape ────────────────────────────────────────────────────────────────
// PerformanceLongAnimationFrameTiming / PerformanceScriptTiming are not yet in
// lib.dom.d.ts for all TS targets, so we use our own minimal shapes.

interface LoafScript {
  startTime:          number;   // PerformanceEntry.startTime (absolute, ms)
  duration:           number;   // PerformanceEntry.duration (ms)
  executionStart:     number;   // when JS actually started executing (excl. compile)
  pauseDuration:      number;   // time the script was paused waiting for style/layout
  sourceURL:          string;   // empty for inline / extension scripts
  sourceFunctionName: string;   // invoking function name (e.g. event handler)
  invokerType:        string;   // 'user-callback' | 'event-listener' | 'resolve-promise' | …
}

interface LoafEntry {
  startTime:        number;   // frame start (absolute, ms)
  duration:         number;   // total frame duration (ms)
  blockingDuration: number;   // portion that blocked the main thread (ms)
  renderStart:      number;   // 0 if there was no render phase in this frame
  scripts:          LoafScript[];
}

// ── Raw longtask accumulator ──────────────────────────────────────────────────

interface RawLongTask {
  startTime: number;
  duration:  number;
}

// ── Collector ─────────────────────────────────────────────────────────────────

export class LongTaskCollector {
  private resetAt       = 0;
  private tasks:        RawLongTask[] = [];
  private loafEntries:  LoafEntry[]   = [];

  private ltObserver:   PerformanceObserver | null = null;
  private loafObserver: PerformanceObserver | null = null;

  // Set to true only when the corresponding observer was successfully started.
  private ltActive   = false;
  private loafActive = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (typeof PerformanceObserver === 'undefined') return;

    const supported = PerformanceObserver.supportedEntryTypes ?? [];

    if (supported.includes('longtask')) {
      try {
        this.ltObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.startTime >= this.resetAt) {
              this.tasks.push({ startTime: entry.startTime, duration: entry.duration });
            }
          }
        });
        this.ltObserver.observe({ type: 'longtask', buffered: true });
        this.ltActive = true;
      } catch {
        // Some browsers list 'longtask' as supported but throw on observe().
      }
    }

    if (supported.includes('long-animation-frame')) {
      try {
        this.loafObserver = new PerformanceObserver(list => {
          for (const raw of list.getEntries()) {
            if (raw.startTime >= this.resetAt) {
              this.loafEntries.push(raw as unknown as LoafEntry);
            }
          }
        });
        this.loafObserver.observe({ type: 'long-animation-frame', buffered: true });
        this.loafActive = true;
      } catch {
        // Chrome 123+ only. Safe to ignore on older browsers.
      }
    }
  }

  /**
   * Called at the start of every new interaction (INITIAL_LOAD and NAVIGATION).
   * `startPerfTime` is `performance.now()` at the moment the interaction began —
   * entries with startTime < startPerfTime belong to the previous interaction.
   */
  reset(startPerfTime: number): void {
    this.resetAt     = startPerfTime;
    this.tasks       = [];
    this.loafEntries = [];
  }

  stop(): void {
    this.ltObserver?.disconnect();
    this.loafObserver?.disconnect();
    this.ltObserver   = null;
    this.loafObserver = null;
  }

  // ── Collection ──────────────────────────────────────────────────────────────

  /**
   * Snapshot the accumulated data into a `TraceMetrics` object.
   *
   * @param domNodeCount - Pass the already-computed domNodeCount from PageContext
   *   to avoid querying the DOM twice. Falls back to querySelectorAll if omitted.
   * @returns `undefined` when neither observer is active (unsupported browser).
   */
  collect(domNodeCount?: number): TraceMetrics | undefined {
    if (!this.ltActive && !this.loafActive) return undefined;

    // ── Long tasks (universal source) ─────────────────────────────────────────
    const sortedTasks = [...this.tasks].sort((a, b) => b.duration - a.duration);
    const longTaskCount = sortedTasks.length;

    const longTasks: LongTask[] = sortedTasks.slice(0, 20).map(t => ({
      startTime: Math.round(t.startTime),
      duration:  Math.round(t.duration),
      blocking:  Math.max(0, Math.round(t.duration - 50)),
    }));

    // ── Aggregate metrics ──────────────────────────────────────────────────────
    let totalBlockingTime: number;
    let mainThreadWork:    number;
    let scriptingTime:     number;
    let renderingTime:     number;
    let topScripts:        ScriptActivity[] | undefined;

    if (this.loafActive && this.loafEntries.length > 0) {
      // LoAF path — Chrome 123+ — gives an accurate per-frame breakdown.
      totalBlockingTime = this.loafEntries.reduce((s, e) => s + (e.blockingDuration ?? 0), 0);
      mainThreadWork    = this.loafEntries.reduce((s, e) => s + e.duration, 0);

      let totalScripting = 0;
      let totalRendering = 0;

      for (const e of this.loafEntries) {
        // renderStart > e.startTime means a render phase actually happened.
        if (e.renderStart > e.startTime) {
          totalScripting += e.renderStart - e.startTime;
          totalRendering += (e.startTime + e.duration) - e.renderStart;
        } else {
          // No render phase — the whole frame was scripting work.
          totalScripting += e.duration;
        }
      }

      scriptingTime = Math.round(totalScripting);
      renderingTime = Math.max(0, Math.round(totalRendering));

      // topScripts — group PerformanceScriptTiming entries by sourceURL.
      const scriptMap = new Map<string, number>();
      for (const e of this.loafEntries) {
        for (const s of e.scripts ?? []) {
          const url = s.sourceURL || '(inline)';
          scriptMap.set(url, (scriptMap.get(url) ?? 0) + s.duration);
        }
      }

      if (scriptMap.size > 0) {
        const totalMs = Array.from(scriptMap.values()).reduce((a, b) => a + b, 0);
        topScripts = Array.from(scriptMap.entries())
          .map(([url, time]) => ({ url, time: Math.round(time), share: totalMs > 0 ? time / totalMs : 0 }))
          .sort((a, b) => b.time - a.time)
          .slice(0, 10);
      }
    } else {
      // Longtask-only fallback — less granular but widely supported.
      totalBlockingTime = this.tasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0);
      mainThreadWork    = this.tasks.reduce((s, t) => s + t.duration, 0);
      // Can't split scripting from rendering without LoAF — attribute all to scripting.
      scriptingTime     = mainThreadWork;
      renderingTime     = 0;
    }

    // ── DOM & memory ───────────────────────────────────────────────────────────
    const domNodes = domNodeCount ?? document.querySelectorAll('*').length;

    const jsHeapUsed = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory?.usedJSHeapSize;

    return {
      totalBlockingTime: Math.round(totalBlockingTime),
      longTaskCount,
      longTasks,
      mainThreadWork:    Math.round(mainThreadWork),
      scriptingTime,
      jsCompileTime:     0,  // CDP only (V8 parse+compile events)
      renderingTime,
      layoutCount:       0,  // CDP only (Layout trace events)
      styleRecalcCount:  0,  // CDP only (UpdateLayoutTree trace events)
      domNodes,
      jsListeners:       0,  // CDP only (DOM.getEventListeners)
      ...(jsHeapUsed !== undefined ? { jsHeapUsed } : {}),
      ...(topScripts ? { topScripts } : {}),
    };
  }
}
