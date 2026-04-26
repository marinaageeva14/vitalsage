import type { ClientConfig } from '@vitalsage/types';
import { collectDeviceContext }   from './collector/device.js';
import { MetricsCollector }       from './collector/metrics.js';
import { NavigationObserver }     from './routing/observer.js';
import { InteractionTracker }     from './interaction/tracker.js';

export interface VitalSageInstance {
  stop: () => void;
}

const NOOP_INSTANCE: VitalSageInstance = { stop: () => {} };

let activeInstance: VitalSageInstance | null = null;

export function init(config: ClientConfig): VitalSageInstance {
  if (typeof window === 'undefined') return NOOP_INSTANCE;

  if (activeInstance) {
    if (config.debug) {
      console.warn('[VitalSage] Already initialised. Call stop() first.');
    }
    return activeInstance;
  }

  const sampling = config.sampling ?? 1.0;
  if (Math.random() > sampling) return NOOP_INSTANCE;

  const device      = collectDeviceContext();
  const metricsCol  = new MetricsCollector();
  const navObserver = new NavigationObserver(config.navigation?.mode ?? 'auto');
  const tracker     = new InteractionTracker(config.storage.adapter, device);

  // Wire metrics → tracker
  metricsCol.subscribe(metric => tracker.onMetric(metric));

  // Wire navigation → tracker
  // Pass the current metric snapshot so the tracker can compute per-route CLS/INP deltas.
  navObserver.onChange(() => {
    const snapshot = metricsCol.getSnapshot();
    tracker.onNavigation(location.href, snapshot);
    metricsCol.reset(); // clear per-route snapshot AFTER tracker has read the baseline
  });

  metricsCol.start();
  navObserver.start();
  tracker.start();  // starts INITIAL_LOAD interaction

  const instance: VitalSageInstance = {
    stop() {
      navObserver.stop();
      tracker.stop();
      metricsCol.reset();
      activeInstance = null;
    },
  };

  activeInstance = instance;
  return instance;
}
