import { onLCP, onFCP, onCLS, onINP, onTTFB, type Metric } from 'web-vitals/attribution';
import type { MetricName, NavigationType, RawMetricValue, MetricAttribution } from '@vitalsage/types';
import { serializeEntry } from '../utils/serialize.js';

type MetricCallback = (metric: RawMetricValue) => void;

/**
 * Reduce the web-vitals attribution object to a serializable subset.
 * Attribution converts "guess the cause" into "here is the measured cause":
 * LCP phases, INP input/processing/presentation split, CLS largest shift.
 * Field names are read defensively — v3 and v4 of web-vitals differ
 * (resourceLoadTime → resourceLoadDuration, processingTime → processingDuration).
 */
function pickAttribution(
  name: MetricName,
  attr: Record<string, unknown> | undefined,
): MetricAttribution | undefined {
  if (!attr) return undefined;

  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = attr[k];
      if (typeof v === 'number' && isFinite(v)) return Math.round(v * 10) / 10;
    }
    return undefined;
  };
  const str = (k: string): string | undefined => {
    const v = attr[k];
    return typeof v === 'string' && v ? v : undefined;
  };
  const compact = (obj: Record<string, unknown>): MetricAttribution | undefined => {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) as MetricAttribution : undefined;
  };

  if (name === 'LCP') {
    return compact({
      timeToFirstByte:      num('timeToFirstByte'),
      resourceLoadDelay:    num('resourceLoadDelay'),
      resourceLoadDuration: num('resourceLoadDuration', 'resourceLoadTime'),
      elementRenderDelay:   num('elementRenderDelay'),
      element:              str('element'),
      url:                  str('url'),
    });
  }
  if (name === 'INP') {
    return compact({
      inputDelay:         num('inputDelay'),
      processingDuration: num('processingDuration', 'processingTime'),
      presentationDelay:  num('presentationDelay'),
      interactionTarget:  str('interactionTarget'),
      interactionType:    str('interactionType'),
      loadState:          str('loadState'),
    });
  }
  if (name === 'CLS') {
    return compact({
      largestShiftTarget: str('largestShiftTarget'),
      largestShiftValue:  num('largestShiftValue'),
      largestShiftTime:   num('largestShiftTime'),
      loadState:          str('loadState'),
    });
  }
  return undefined;
}

export class MetricsCollector {
  private subscribers: MetricCallback[] = [];
  private snapshot: Partial<Record<MetricName, RawMetricValue>> = {};
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    const emit = (name: MetricName) => (raw: Metric): void => {
      const attribution = pickAttribution(
        name,
        (raw as unknown as { attribution?: Record<string, unknown> }).attribution,
      );
      const metric: RawMetricValue = {
        name,
        value:          raw.value,
        rating:         raw.rating,
        delta:          raw.delta,
        id:             raw.id,
        navigationType: raw.navigationType as NavigationType,
        entries:        raw.entries.map(serializeEntry),
        ...(attribution ? { attribution } : {}),
      };
      this.snapshot[name] = metric;
      this.subscribers.forEach(cb => cb(metric));
    };

    // reportAllChanges: true for metrics that can update multiple times
    onLCP(emit('LCP'),   { reportAllChanges: true });
    onCLS(emit('CLS'),   { reportAllChanges: true });
    onINP(emit('INP'),   { reportAllChanges: true });
    // These fire exactly once
    onFCP(emit('FCP'),   { reportAllChanges: false });
    onTTFB(emit('TTFB'), { reportAllChanges: false });
  }

  subscribe(cb: MetricCallback): () => void {
    this.subscribers.push(cb);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== cb);
    };
  }

  getSnapshot(): Partial<Record<MetricName, RawMetricValue>> {
    return { ...this.snapshot };
  }

  // Called on SPA navigation — clears per-route metrics.
  // LCP/FCP do NOT re-fire after SPA nav (web-vitals design); callers handle this.
  reset(): void {
    this.snapshot = {};
  }
}
