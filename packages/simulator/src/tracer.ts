import type { Page, CDPSession } from 'playwright';
import type { TraceMetrics, LongTask, ScriptActivity, FunctionProfile } from '@vitalsage/types';

interface CDPMetric { name: string; value: number }

interface PageMetrics {
  TaskDuration:        number;
  ScriptDuration:      number;
  V8CompileDuration:   number;
  RecalcStyleDuration: number;
  LayoutDuration:      number;
  LayoutCount:         number;
  RecalcStyleCount:    number;
  Nodes:               number;
  JSEventListeners:    number;
  JSHeapUsedSize?:     number;
  [key: string]:       number | undefined;
}

export interface LoadPhaseSnapshot {
  metrics:    Record<string, number>;
  longTasks:  Array<{ startTime: number; duration: number; blocking: number }>;
  /** Per-script execution time extracted from CDP trace events. */
  topScripts?:   ScriptActivity[];
  /** Per-function CPU profile (only when captureFullTrace: true). */
  topFunctions?: FunctionProfile[];
}

// cdpSession must have had Performance.enable called BEFORE page.goto().
// loadPhase should be the snapshot taken immediately after networkidle so that
// timing counters, TBT, and long tasks all reflect the same measurement window.
export async function collectTraceMetrics(
  page:          Page,
  cdpSession?:   CDPSession,
  loadPhase?:    LoadPhaseSnapshot,
): Promise<TraceMetrics> {
  let pageMetrics: PageMetrics;
  let rawLongTaskSource: Array<{ startTime: number; duration: number; blocking: number }>;

  if (loadPhase) {
    pageMetrics = { ...loadPhase.metrics } as unknown as PageMetrics;
    rawLongTaskSource = loadPhase.longTasks;
    // Heap is read live (after waitAfterLoad) — it reflects the fully settled page.
    if (cdpSession) {
      const { metrics } = await cdpSession.send('Performance.getMetrics') as { metrics: CDPMetric[] };
      const live = Object.fromEntries(metrics.map(m => [m.name, m.value]));
      const liveHeap = live['JSHeapUsedSize'];
      if (liveHeap !== undefined) pageMetrics.JSHeapUsedSize = liveHeap;
    }
  } else {
    let client: CDPSession;
    let owned = false;
    if (cdpSession) {
      client = cdpSession;
    } else {
      client = await page.context().newCDPSession(page);
      await client.send('Performance.enable');
      owned = true;
    }
    try {
      const { metrics } = await client.send('Performance.getMetrics') as { metrics: CDPMetric[] };
      pageMetrics = Object.fromEntries(metrics.map(m => [m.name, m.value])) as unknown as PageMetrics;
    } finally {
      if (owned) await client.detach().catch(() => {});
    }
    rawLongTaskSource = await page.evaluate(() => {
      type E = { startTime: number; duration: number; blocking: number };
      const s = (window as unknown as { __vitalsage_session?: { longTasks?: E[] } }).__vitalsage_session;
      return s?.longTasks ?? ([] as E[]);
    });
  }

  const longTasks: LongTask[] = rawLongTaskSource
    .map(t => ({ startTime: t.startTime, duration: t.duration, blocking: t.blocking }))
    .sort((a, b) => b.duration - a.duration);

  const totalBlockingTime = longTasks.reduce((sum, t) => sum + t.blocking, 0);

  const result: TraceMetrics = {
    totalBlockingTime,
    longTaskCount:    longTasks.length,
    longTasks,
    mainThreadWork:   Math.round((pageMetrics.TaskDuration ?? 0) * 1000),
    scriptingTime:    Math.round((pageMetrics.ScriptDuration ?? 0) * 1000),
    jsCompileTime:    Math.round((pageMetrics.V8CompileDuration ?? 0) * 1000),
    renderingTime:    Math.round(((pageMetrics.RecalcStyleDuration ?? 0) + (pageMetrics.LayoutDuration ?? 0)) * 1000),
    layoutCount:      Math.round(pageMetrics.LayoutCount ?? 0),
    styleRecalcCount: Math.round(pageMetrics.RecalcStyleCount ?? 0),
    domNodes:         Math.round(pageMetrics.Nodes ?? 0),
    jsListeners:      Math.round(pageMetrics.JSEventListeners ?? 0),
  };

  const heapUsed = pageMetrics.JSHeapUsedSize;
  if (heapUsed !== undefined) {
    result.jsHeapUsed = Math.round(heapUsed / 1024 / 1024);
  }

  // Attach per-script breakdown from CDP trace events (only present when
  // Tracing.start/stop was used — i.e. loadPhase was provided by runner.ts).
  if (loadPhase?.topScripts && loadPhase.topScripts.length > 0) {
    result.topScripts = loadPhase.topScripts;
  }

  // Attach per-function CPU profile (only present with captureFullTrace: true).
  if (loadPhase?.topFunctions && loadPhase.topFunctions.length > 0) {
    result.topFunctions = loadPhase.topFunctions;
  }

  return result;
}
