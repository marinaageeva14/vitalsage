import type { ConnectionType } from './context.js';

export type MetricName   = 'LCP' | 'FCP' | 'CLS' | 'INP' | 'TTFB';
export type MetricRating = 'good' | 'needs-improvement' | 'poor';
export type NavigationType =
  | 'navigate'
  | 'reload'
  | 'back-forward'
  | 'back-forward-cache'
  | 'prerender';

export interface RawMetricValue {
  name:           MetricName;
  value:          number;
  rating:         MetricRating;
  delta:          number;
  id:             string;
  navigationType: NavigationType;
  entries:        SerializablePerformanceEntry[];
}

export interface SerializableRect {
  x?: number; y?: number; width?: number; height?: number;
  top?: number; right?: number; bottom?: number; left?: number;
}

export interface SerializablePerformanceEntry {
  entryType:  string;
  name:       string;
  startTime:  number;
  duration:   number;
  // LCP-specific
  element?:     string;
  url?:         string;
  loadTime?:    number;
  renderTime?:  number;
  // CLS-specific
  hadRecentInput?: boolean;
  value?:          number;
  sources?:        Array<{
    node:         string;
    currentRect:  SerializableRect;
    previousRect: SerializableRect;
  }>;
  // INP-specific
  processingStart?: number;
  processingEnd?:   number;
  interactionId?:   number;
}

export interface CoreWebVitals {
  LCP?:  RawMetricValue;
  FCP?:  RawMetricValue;
  CLS?:  RawMetricValue;
  INP?:  RawMetricValue;
  TTFB?: RawMetricValue;
}

export interface MetricThresholds {
  good: number;
  poor: number;
}

export type ThresholdConfig = Record<MetricName, MetricThresholds>;

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  LCP:  { good: 2500, poor: 4000  },
  FCP:  { good: 1800, poor: 3000  },
  CLS:  { good: 0.1,  poor: 0.25  },
  INP:  { good: 200,  poor: 500   },
  TTFB: { good: 800,  poor: 1800  },
};

export interface MetricDistribution {
  p50:        number;
  p75:        number;
  p90:        number;
  p95:        number;
  p99:        number;
  min:        number;
  max:        number;
  mean:       number;
  stdDev:     number;
  sampleSize: number;
  rating:     MetricRating;
  histogram:  HistogramBucket[];
  byDevice:     Partial<Record<'mobile' | 'desktop' | 'tablet', MetricDistribution>>;
  byConnection: Partial<Record<ConnectionType, MetricDistribution>>;
}

export interface HistogramBucket {
  lowerBound: number;
  upperBound: number;
  count:      number;
  percentage: number;
}
