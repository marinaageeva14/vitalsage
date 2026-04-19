import type { BatchingConfig, MetricDataPoint } from '@vitalsage/types';

export class MetricBatcher {
  private buffer: MetricDataPoint[] = [];
  private timer:  ReturnType<typeof setTimeout> | null = null;
  private cfg:    Required<BatchingConfig>;
  private onFlush: (metrics: MetricDataPoint[]) => void;

  constructor(config: BatchingConfig, onFlush: (metrics: MetricDataPoint[]) => void) {
    this.cfg = { maxSize: 10, flushInterval: 5000, ...config };
    this.onFlush = onFlush;
  }

  add(metric: MetricDataPoint): void {
    this.buffer.push(metric);
    if (this.buffer.length >= this.cfg.maxSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.cfg.flushInterval);
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.onFlush(batch);
  }

  destroy(): void {
    this.flush();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
