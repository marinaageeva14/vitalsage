import type {
  ClientConfig,
  MetricDataPoint,
  PageContext,
  SerializablePerformanceEntry,
} from '@vitalsage/types';
import { generateId } from './utils/id.js';
import { isDev } from './utils/env.js';
import { collectDeviceContext } from './collector/device.js';
import { MetricsCollector } from './collector/metrics.js';
import { ContextCollector } from './collector/context.js';
import { RouteContextManager } from './routing/manager.js';
import { NavigationObserver } from './routing/observer.js';
import { MetricBatcher } from './storage/batcher.js';
import { LifecycleManager } from './storage/lifecycle.js';
import { ConsoleReporter } from './reporter/console.js';

export interface VitalSageInstance {
  stop: () => void;
}

const NOOP_INSTANCE: VitalSageInstance = { stop: () => {} };

let activeInstance: VitalSageInstance | null = null;

export function init(config: ClientConfig): VitalSageInstance {
  if (typeof window === 'undefined') return NOOP_INSTANCE;

  if (activeInstance) {
    if (config.debug) console.warn('[VitalSage] Already initialized. Call stop() first.');
    return activeInstance;
  }

  const sampling = config.sampling ?? 1.0;
  if (Math.random() > sampling) return NOOP_INSTANCE;

  const sessionId    = generateId();
  const device       = collectDeviceContext();
  const routeManager = new RouteContextManager(config.routes ?? []);
  const navObserver  = new NavigationObserver(config.navigation?.mode ?? 'auto');
  const metricsCol   = new MetricsCollector();
  const contextCol   = new ContextCollector();
  const reporter     = new ConsoleReporter();

  const adapter  = config.storage.adapter;
  const batcher  = config.storage.batching?.enabled
    ? new MetricBatcher(config.storage.batching, metrics =>
        metrics.forEach(m => safeCall(() => adapter.onMetric?.(m)))
      )
    : null;

  const shouldConsole = config.reporter?.console ?? isDev();

  let currentPage: PageContext | null = null;
  let lcpEntries: SerializablePerformanceEntry[] = [];

  const buildReport = () => ({
    sessionId,
    visitId:    routeManager.current().visitId,
    route:      routeManager.current(),
    url:        location.href,
    timestamp:  Date.now(),
    device,
    page:       currentPage ?? contextCol.collect(),
    metrics:    metricsCol.getSnapshot(),
    synthetic:  false,
    sdkVersion: '__VERSION__',
  });

  const lifecycle = new LifecycleManager(buildReport, adapter);
  lifecycle.attach();

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      metricsCol.reset();
      currentPage = null;
      lcpEntries = [];
      routeManager.navigate(location.pathname);
      metricsCol.start();
    }
  });

  metricsCol.subscribe((metric) => {
    const route = routeManager.current();

    if (metric.name === 'LCP') {
      lcpEntries = metric.entries;
      currentPage = contextCol.collect(lcpEntries);
    }

    const dataPoint: MetricDataPoint = {
      sessionId,
      visitId:        route.visitId,
      name:           metric.name,
      value:          metric.value,
      rating:         metric.rating,
      delta:          metric.delta,
      route,
      timestamp:      Date.now(),
      navigationType: metric.navigationType,
    };

    if (batcher) {
      batcher.add(dataPoint);
    } else {
      safeCall(() => adapter.onMetric?.(dataPoint));
    }

    if (shouldConsole) reporter.reportMetric(metric, route);
  });

  navObserver.onChange((path) => {
    batcher?.flush();
    lifecycle.emitForVisit(routeManager.current().visitId);

    routeManager.navigate(path);
    metricsCol.reset();
    currentPage = null;
    lcpEntries = [];

    if (shouldConsole) {
      console.log(`%c[VitalSage] Navigation → ${path}`, 'color:#6366f1');
    }
  });

  navObserver.start();
  metricsCol.start();

  const instance: VitalSageInstance = {
    stop() {
      navObserver.stop();
      batcher?.destroy();
      activeInstance = null;
    },
  };

  activeInstance = instance;
  return instance;
}

function safeCall(fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch(err => console.warn('[VitalSage] adapter callback error:', err));
    }
  } catch (err) {
    console.warn('[VitalSage] adapter callback threw:', err);
  }
}

