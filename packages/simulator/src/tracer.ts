import type { Page } from 'playwright';
import type { TraceMetrics, LongTask } from '@vitalsage/types';

interface PlaywrightMetrics {
  TaskDuration:         number;
  ScriptDuration:       number;
  RecalcStyleDuration:  number;
  LayoutDuration:       number;
  PaintDuration:        number;
  LayoutCount:          number;
  RecalcStyleCount:     number;
  Nodes:                number;
  JSEventListeners:     number;
  JSHeapUsedSize?:      number;
  [key: string]:        number | undefined;
}

type PageWithMetrics = { metrics(): Promise<PlaywrightMetrics> };

export async function collectTraceMetrics(page: Page): Promise<TraceMetrics> {
  const [pageMetrics, rawLongTasks] = await Promise.all([
    (page as unknown as PageWithMetrics).metrics(),
    page.evaluate(() => {
      type LongTaskEntry = { startTime: number; duration: number; blocking: number };
      const s = (window as unknown as { __vitalsage_session?: { longTasks?: LongTaskEntry[] } }).__vitalsage_session;
      return s?.longTasks ?? ([] as LongTaskEntry[]);
    }),
  ]);

  const longTasks: LongTask[] = (rawLongTasks as Array<{ startTime: number; duration: number; blocking: number }>)
    .map(t => ({ startTime: t.startTime, duration: t.duration, blocking: t.blocking }))
    .sort((a, b) => b.duration - a.duration);

  const totalBlockingTime = longTasks.reduce((sum, t) => sum + t.blocking, 0);

  const result: TraceMetrics = {
    totalBlockingTime,
    longTaskCount:    longTasks.length,
    longTasks,
    mainThreadWork:   Math.round((pageMetrics.TaskDuration ?? 0) * 1000),
    scriptingTime:    Math.round((pageMetrics.ScriptDuration ?? 0) * 1000),
    renderingTime:    Math.round(((pageMetrics.RecalcStyleDuration ?? 0) + (pageMetrics.LayoutDuration ?? 0)) * 1000),
    paintingTime:     Math.round((pageMetrics.PaintDuration ?? 0) * 1000),
    layoutCount:      Math.round(pageMetrics.LayoutCount ?? 0),
    styleRecalcCount: Math.round(pageMetrics.RecalcStyleCount ?? 0),
    domNodes:         Math.round(pageMetrics.Nodes ?? 0),
    jsListeners:      Math.round(pageMetrics.JSEventListeners ?? 0),
  };

  const heapUsed = pageMetrics.JSHeapUsedSize;
  if (heapUsed !== undefined) {
    result.jsHeapUsed = Math.round(heapUsed / 1024 / 1024);
  }

  return result;
}
