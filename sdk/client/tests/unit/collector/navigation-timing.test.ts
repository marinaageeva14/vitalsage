import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectNavigationTiming } from '../../../src/collector/navigation-timing.js';

function makeNavEntry(overrides: Partial<PerformanceNavigationTiming> = {}): PerformanceNavigationTiming {
  return {
    // baseline zero timings
    startTime:              0,
    redirectStart:          0,
    redirectEnd:            0,
    fetchStart:             0,
    domainLookupStart:      10,
    domainLookupEnd:        20,
    connectStart:           20,
    secureConnectionStart:  0,
    connectEnd:             30,
    requestStart:           30,
    responseStart:          80,
    responseEnd:            120,
    domInteractive:         200,
    domContentLoadedEventStart: 210,
    domContentLoadedEventEnd:   215,
    domComplete:            300,
    loadEventStart:         300,
    loadEventEnd:           310,
    workerStart:            0,
    redirectCount:          0,
    type:                   'navigate',
    name:                   location.href,
    entryType:              'navigation',
    duration:               310,
    transferSize:           0,
    encodedBodySize:        0,
    decodedBodySize:        0,
    initiatorType:          'navigation',
    nextHopProtocol:        'h2',
    renderBlockingStatus:   'non-blocking' as unknown as never,
    toJSON: () => ({}),
    ...overrides,
  } as unknown as PerformanceNavigationTiming;
}

describe('collectNavigationTiming', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns correct timings from a typical navigation entry', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([makeNavEntry()]);
    const t = collectNavigationTiming();

    expect(t.dnsTime).toBe(10);        // 20 - 10
    expect(t.serverTime).toBe(50);     // 80 - 30
    expect(t.downloadTime).toBe(40);   // 120 - 80
    expect(t.domParseTime).toBe(80);   // 200 - 120
    expect(t.totalLoadTime).toBe(310); // 310 - 0
    expect(t.redirectTime).toBe(0);
    expect(t.tlsTime).toBe(0);         // no TLS (secureConnectionStart = 0)
    expect(t.isServiceWorker).toBe(false);
    expect(t.redirectCount).toBe(0);
  });

  it('calculates TLS time when secureConnectionStart > 0', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ secureConnectionStart: 25, connectEnd: 40 }),
    ]);
    const t = collectNavigationTiming();
    expect(t.tlsTime).toBe(15); // 40 - 25
  });

  it('does not calculate TLS time when secureConnectionStart is 0 (plain HTTP)', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ secureConnectionStart: 0 }),
    ]);
    expect(collectNavigationTiming().tlsTime).toBe(0);
  });

  it('detects service worker (workerStart > 0)', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ workerStart: 5, responseStart: 80 }),
    ]);
    const t = collectNavigationTiming();
    expect(t.isServiceWorker).toBe(true);
    expect(t.workerTime).toBe(75); // 80 - 5
  });

  it('workerTime is 0 when no service worker', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ workerStart: 0 }),
    ]);
    expect(collectNavigationTiming().workerTime).toBe(0);
  });

  it('clamps negative values to 0', () => {
    // Cross-origin redirects can produce redacted (zero) timing, causing negative subtraction
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ responseStart: 0, requestStart: 30 }), // serverTime would be negative
    ]);
    expect(collectNavigationTiming().serverTime).toBe(0);
  });

  it('handles loadEventEnd = 0 (collector ran before load event)', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ loadEventEnd: 0, startTime: 0 }),
    ]);
    expect(collectNavigationTiming().totalLoadTime).toBe(0);
  });

  it('includes redirectCount', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      makeNavEntry({ redirectStart: 0, redirectEnd: 5, redirectCount: 2 }),
    ]);
    const t = collectNavigationTiming();
    expect(t.redirectCount).toBe(2);
    expect(t.redirectTime).toBe(5);
  });

  it('returns empty timing when no navigation entry available', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    const t = collectNavigationTiming();

    expect(t.dnsTime).toBe(0);
    expect(t.serverTime).toBe(0);
    expect(t.isServiceWorker).toBe(false);
    expect(t.redirectCount).toBe(0);
  });
});
