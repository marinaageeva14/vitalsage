import type { SessionReport, DeviceContext, PageContext, NavigationTimingSnapshot } from '@vitalsage/types';

export function buildMockDevice(overrides: Partial<DeviceContext> = {}): DeviceContext {
  return {
    userAgent:           'Mozilla/5.0',
    viewport:            { width: 1280, height: 720 },
    devicePixelRatio:    1,
    hardwareConcurrency: 4,
    deviceCategory:      'desktop',
    connection:          { type: '4g' },
    ...overrides,
  };
}

function buildMockNavTiming(): NavigationTimingSnapshot {
  return {
    redirectTime:    0,
    dnsTime:         10,
    tlsTime:         30,
    serverTime:      200,
    downloadTime:    50,
    domParseTime:    100,
    totalLoadTime:   500,
    workerTime:      0,
    isServiceWorker: false,
    redirectCount:   0,
  };
}

export function buildMockPage(): PageContext {
  return {
    url:              'https://example.com/',
    referrer:         '',
    title:            'Example',
    domNodeCount:     100,
    resources:        [],
    fonts:            [],
    images:           [],
    scripts:          [],
    stylesheets:      [],
    navigationTiming: buildMockNavTiming(),
  };
}

let counter = 0;

export function buildMockSession(overrides: Partial<SessionReport> = {}): SessionReport {
  counter++;
  return {
    sessionId:  `session-${counter}`,
    visitId:    `visit-${counter}`,
    route:      { pattern: '/', path: '/', visitId: `v${counter}`, navigationIndex: 0 },
    url:        'https://example.com/',
    timestamp:  Date.now() - counter * 1000,
    device:     buildMockDevice(),
    page:       buildMockPage(),
    metrics:    {},
    synthetic:  false,
    sdkVersion: '0.1.0',
    ...overrides,
  };
}

export function buildSessionsWithLCP(values: number[]): SessionReport[] {
  return values.map(value =>
    buildMockSession({
      metrics: { LCP: { name: 'LCP', value, rating: 'good', delta: value, id: `lcp-${value}`, navigationType: 'navigate', entries: [] } },
    })
  );
}
