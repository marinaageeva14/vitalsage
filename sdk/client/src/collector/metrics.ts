import { onLCP, onFCP, onCLS, onINP, onTTFB, type Metric } from 'web-vitals';
import type { MetricName, NavigationType, RawMetricValue } from '@vitalsage/types';
import { serializeEntry } from '../utils/serialize.js';

type MetricCallback = (metric: RawMetricValue) => void;

export class MetricsCollector {
  private subscribers: MetricCallback[] = [];
  private snapshot: Partial<Record<MetricName, RawMetricValue>> = {};
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    const emit = (name: MetricName) => (raw: Metric): void => {
      const metric: RawMetricValue = {
        name,
        value:          raw.value,
        rating:         raw.rating,
        delta:          raw.delta,
        id:             raw.id,
        navigationType: raw.navigationType as NavigationType,
        entries:        raw.entries.map(serializeEntry),
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
