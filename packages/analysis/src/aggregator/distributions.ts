import type {
  SessionReport,
  MetricName,
  MetricRating,
  MetricDistribution,
  MetricThresholds,
  ThresholdConfig,
  HistogramBucket,
  ConnectionType,
} from '@vitalsage/types';
import { DEFAULT_THRESHOLDS } from '@vitalsage/types';

const METRICS: MetricName[] = ['LCP', 'FCP', 'CLS', 'INP', 'TTFB'];

export function computeDistributions(
  sessions: SessionReport[],
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS,
): Partial<Record<MetricName, MetricDistribution>> {
  const result: Partial<Record<MetricName, MetricDistribution>> = {};

  for (const name of METRICS) {
    const values = sessions
      .map(s => s.metrics[name]?.value)
      .filter((v): v is number => typeof v === 'number' && isFinite(v));

    if (values.length < 1) continue;

    result[name] = buildDistribution(values, name, thresholds[name], sessions);
  }

  return result;
}

function buildDistribution(
  values: number[],
  name: MetricName,
  threshold: MetricThresholds,
  sessions: SessionReport[],
): MetricDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const p75Value = percentile(sorted, 75);

  return {
    p50:        percentile(sorted, 50),
    p75:        p75Value,
    p90:        percentile(sorted, 90),
    p95:        percentile(sorted, 95),
    p99:        percentile(sorted, 99),
    min:        sorted[0]!,
    max:        sorted[n - 1]!,
    mean:       values.reduce((a, b) => a + b, 0) / n,
    stdDev:     computeStdDev(values),
    sampleSize: n,
    rating:     rateMetric(p75Value, threshold),
    histogram:  buildHistogram(sorted, name),
    byDevice:   computeDeviceBreakdown(sessions, name, threshold),
    byConnection: computeConnectionBreakdown(sessions, name, threshold),
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  // Linear interpolation — matches Chrome CrUX methodology
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  const frac = idx - lower;
  return sorted[lower]! * (1 - frac) + sorted[upper]! * frac;
}

export function rateMetric(value: number, threshold: MetricThresholds): MetricRating {
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

function computeStdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function buildHistogram(sorted: number[], _name: MetricName): HistogramBucket[] {
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const bucketCount = 10;
  const step = (max - min) / bucketCount || 1;
  const buckets: HistogramBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const lower = min + i * step;
    const upper = lower + step;
    const isLast = i === bucketCount - 1;
    const count = sorted.filter(v => v >= lower && (isLast ? v <= upper : v < upper)).length;
    buckets.push({ lowerBound: lower, upperBound: upper, count, percentage: (count / sorted.length) * 100 });
  }
  return buckets;
}

function buildSubDistribution(
  values: number[],
  threshold: MetricThresholds,
  name: MetricName,
): MetricDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const p75Value = percentile(sorted, 75);
  return {
    p50: percentile(sorted, 50), p75: p75Value,
    p90: percentile(sorted, 90), p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0]!,             max: sorted[sorted.length - 1]!,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    stdDev: computeStdDev(values),
    sampleSize: values.length,
    rating: rateMetric(p75Value, threshold),
    histogram: buildHistogram(sorted, name),
    byDevice: {}, byConnection: {},
  };
}

function computeDeviceBreakdown(
  sessions: SessionReport[],
  name: MetricName,
  threshold: MetricThresholds,
): MetricDistribution['byDevice'] {
  const groups: Partial<Record<'mobile' | 'desktop' | 'tablet', number[]>> = {};

  for (const session of sessions) {
    const value = session.metrics[name]?.value;
    if (typeof value !== 'number') continue;
    const cat = session.device.deviceCategory;
    (groups[cat] ??= []).push(value);
  }

  const result: MetricDistribution['byDevice'] = {};
  for (const [cat, values] of Object.entries(groups) as [keyof MetricDistribution['byDevice'], number[]][]) {
    if (values.length < 5) continue;
    result[cat] = buildSubDistribution(values, threshold, name);
  }
  return result;
}

function computeConnectionBreakdown(
  sessions: SessionReport[],
  name: MetricName,
  threshold: MetricThresholds,
): MetricDistribution['byConnection'] {
  const groups: Partial<Record<ConnectionType, number[]>> = {};

  for (const session of sessions) {
    const value = session.metrics[name]?.value;
    if (typeof value !== 'number') continue;
    const type = session.device.connection.type;
    (groups[type] ??= []).push(value);
  }

  const result: MetricDistribution['byConnection'] = {};
  for (const [type, values] of Object.entries(groups) as [ConnectionType, number[]][]) {
    if (values.length < 5) continue;
    result[type] = buildSubDistribution(values, threshold, name);
  }
  return result;
}
