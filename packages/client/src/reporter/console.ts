import type { MetricName, MetricRating, RawMetricValue, RouteContext } from '@vitalsage/types';

const RATING_EMOJI: Record<MetricRating, string> = {
  'good':               '🟢',
  'needs-improvement':  '🟡',
  'poor':               '🔴',
};

export class ConsoleReporter {
  reportMetric(metric: RawMetricValue, route: RouteContext): void {
    const formatted = formatValue(metric.name, metric.value);
    console.log(
      `%c[VitalSage] ${metric.name} ${RATING_EMOJI[metric.rating]} ${formatted}` +
      ` — ${route.label ?? route.path}`,
      'color: #6366f1; font-weight: bold',
    );
  }

  reportCollection(metrics: Partial<Record<MetricName, RawMetricValue>>, route: RouteContext): void {
    if (!Object.keys(metrics).length) return;
    console.groupCollapsed(`%c⚡ VitalSage collected — ${route.label ?? route.path}`, 'color:#6366f1');
    const rows = Object.fromEntries(
      Object.entries(metrics).map(([name, m]) => [
        name,
        { value: formatValue(name as MetricName, m.value), rating: RATING_EMOJI[m.rating] },
      ])
    );
    console.table(rows);
    console.log('%cData sent to storage adapter', 'color: #6b7280; font-style: italic');
    console.groupEnd();
  }
}

function formatValue(name: MetricName, value: number): string {
  if (name === 'CLS') return value.toFixed(3);
  return `${Math.round(value)}ms`;
}
