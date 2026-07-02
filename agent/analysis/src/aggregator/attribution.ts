/**
 * Aggregates per-session metric attribution into prompt-ready summaries.
 *
 * Attribution turns "ask the model to guess the cause" into "hand the model
 * the measured cause": LCP phase medians, INP phase medians + top interaction
 * targets, CLS top shift targets. All fields are optional — RUM sessions from
 * older SDK versions and metrics without attribution simply contribute nothing.
 */
import type {
  SessionReport,
  LCPAttribution,
  INPAttribution,
  CLSAttribution,
} from '@vitalsage/types';

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mostCommon(values: string[]): string | undefined {
  if (!values.length) return undefined;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export interface LCPPhaseSummary {
  sampleCount:           number;
  timeToFirstByte?:      number | undefined;
  resourceLoadDelay?:    number | undefined;
  resourceLoadDuration?: number | undefined;
  elementRenderDelay?:   number | undefined;
  element?:              string | undefined;
  url?:                  string | undefined;
}

export function aggregateLCPAttribution(sessions: SessionReport[]): LCPPhaseSummary | undefined {
  const attrs = sessions
    .map(s => s.metrics.LCP?.attribution as LCPAttribution | undefined)
    .filter((a): a is LCPAttribution => !!a);
  if (!attrs.length) return undefined;

  const num = (k: keyof LCPAttribution) =>
    median(attrs.map(a => a[k]).filter((v): v is number => typeof v === 'number'));

  return {
    sampleCount:          attrs.length,
    timeToFirstByte:      num('timeToFirstByte'),
    resourceLoadDelay:    num('resourceLoadDelay'),
    resourceLoadDuration: num('resourceLoadDuration'),
    elementRenderDelay:   num('elementRenderDelay'),
    element:              mostCommon(attrs.map(a => a.element).filter((v): v is string => !!v)),
    url:                  mostCommon(attrs.map(a => a.url).filter((v): v is string => !!v)),
  };
}

export interface INPPhaseSummary {
  sampleCount:         number;
  inputDelay?:         number | undefined;
  processingDuration?: number | undefined;
  presentationDelay?:  number | undefined;
  /** target → occurrence count, most frequent first (top 5). */
  topTargets:          Array<{ target: string; count: number }>;
  interactionType?:    string | undefined;
}

export function aggregateINPAttribution(sessions: SessionReport[]): INPPhaseSummary | undefined {
  const attrs = sessions
    .map(s => s.metrics.INP?.attribution as INPAttribution | undefined)
    .filter((a): a is INPAttribution => !!a);
  if (!attrs.length) return undefined;

  const num = (k: 'inputDelay' | 'processingDuration' | 'presentationDelay') =>
    median(attrs.map(a => a[k]).filter((v): v is number => typeof v === 'number'));

  const targetCounts = new Map<string, number>();
  for (const a of attrs) {
    if (a.interactionTarget) {
      targetCounts.set(a.interactionTarget, (targetCounts.get(a.interactionTarget) ?? 0) + 1);
    }
  }

  return {
    sampleCount:        attrs.length,
    inputDelay:         num('inputDelay'),
    processingDuration: num('processingDuration'),
    presentationDelay:  num('presentationDelay'),
    topTargets:         [...targetCounts.entries()]
      .map(([target, count]) => ({ target, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    interactionType:    mostCommon(attrs.map(a => a.interactionType).filter((v): v is string => !!v)),
  };
}

export interface CLSSourceSummary {
  sampleCount: number;
  /** element → sessions in which it was the largest shift / total shift value. */
  topSources:  Array<{ element: string; sessions: number; totalShift: number }>;
}

export function aggregateCLSSources(sessions: SessionReport[]): CLSSourceSummary | undefined {
  const acc = new Map<string, { sessions: number; totalShift: number }>();
  let sampleCount = 0;

  for (const s of sessions) {
    const cls = s.metrics.CLS;
    if (!cls) continue;

    const attr = cls.attribution as CLSAttribution | undefined;
    const seen = new Set<string>();

    if (attr?.largestShiftTarget) {
      sampleCount++;
      seen.add(attr.largestShiftTarget);
      const cur = acc.get(attr.largestShiftTarget) ?? { sessions: 0, totalShift: 0 };
      cur.sessions++;
      cur.totalShift += attr.largestShiftValue ?? 0;
      acc.set(attr.largestShiftTarget, cur);
      continue;
    }

    // Fallback: serialized layout-shift entries carry per-shift sources
    // (element descriptions) — captured by the SDK but previously unused.
    let counted = false;
    for (const entry of cls.entries) {
      if (entry.entryType !== 'layout-shift' || !entry.sources?.length) continue;
      counted = true;
      for (const src of entry.sources) {
        if (!src.node || src.node === 'unknown' || seen.has(src.node)) continue;
        seen.add(src.node);
        const cur = acc.get(src.node) ?? { sessions: 0, totalShift: 0 };
        cur.sessions++;
        cur.totalShift += entry.value ?? 0;
        acc.set(src.node, cur);
      }
    }
    if (counted) sampleCount++;
  }

  if (!acc.size) return undefined;

  return {
    sampleCount,
    topSources: [...acc.entries()]
      .map(([element, v]) => ({ element, ...v }))
      .sort((a, b) => b.totalShift - a.totalShift)
      .slice(0, 5),
  };
}
