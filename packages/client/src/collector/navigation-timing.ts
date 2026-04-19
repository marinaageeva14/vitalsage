import type { NavigationTimingSnapshot } from '@vitalsage/types';

export function collectNavigationTiming(): NavigationTimingSnapshot {
  const entries = performance.getEntriesByType('navigation');
  const nav = entries[0] as PerformanceNavigationTiming | undefined;

  if (!nav) {
    return emptyNavigationTiming();
  }

  // secureConnectionStart is 0 for plain HTTP — guard before subtracting
  const tlsTime = nav.secureConnectionStart > 0
    ? nav.connectEnd - nav.secureConnectionStart
    : 0;

  return {
    redirectTime:    Math.max(0, nav.redirectEnd - nav.redirectStart),
    dnsTime:         Math.max(0, nav.domainLookupEnd - nav.domainLookupStart),
    tlsTime,
    serverTime:      Math.max(0, nav.responseStart - nav.requestStart),
    downloadTime:    Math.max(0, nav.responseEnd - nav.responseStart),
    domParseTime:    Math.max(0, nav.domInteractive - nav.responseEnd),
    totalLoadTime:   Math.max(0, nav.loadEventEnd - nav.startTime),
    workerTime:      nav.workerStart > 0 ? Math.max(0, nav.responseStart - nav.workerStart) : 0,
    isServiceWorker: nav.workerStart > 0,
    redirectCount:   nav.redirectCount,
  };
}

function emptyNavigationTiming(): NavigationTimingSnapshot {
  return {
    redirectTime: 0, dnsTime: 0, tlsTime: 0, serverTime: 0,
    downloadTime: 0, domParseTime: 0, totalLoadTime: 0, workerTime: 0,
    isServiceWorker: false, redirectCount: 0,
  };
}
