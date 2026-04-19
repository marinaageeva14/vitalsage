import type { MetricDataPoint, SessionReport } from './session.js';

export interface StorageAdapter {
  onMetric?: (metric: MetricDataPoint) => void | Promise<void>;
  onReport?: (report: SessionReport) => void | Promise<void>;
}

export interface BatchingConfig {
  enabled:        boolean;
  maxSize?:       number;
  flushInterval?: number;
}
