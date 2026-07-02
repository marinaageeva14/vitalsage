import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MetricsCollector } from '../../../src/collector/metrics.js';

// Mock web-vitals — controlled callbacks
vi.mock('web-vitals/attribution', () => {
  const callbacks: Record<string, Array<(m: unknown) => void>> = {};

  const makeRegister = (name: string) => (cb: (m: unknown) => void) => {
    if (!callbacks[name]) callbacks[name] = [];
    callbacks[name].push(cb);
  };

  return {
    onLCP:  makeRegister('LCP'),
    onFCP:  makeRegister('FCP'),
    onCLS:  makeRegister('CLS'),
    onINP:  makeRegister('INP'),
    onTTFB: makeRegister('TTFB'),
    _fire: (name: string, metric: unknown) => {
      callbacks[name]?.forEach(cb => cb(metric));
    },
    _reset: () => { Object.keys(callbacks).forEach(k => delete callbacks[k]); },
  };
});

async function getFireFn() {
  const wv = await import('web-vitals/attribution');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (wv as any)._fire as (name: string, m: unknown) => void;
}

async function getResetFn() {
  const wv = await import('web-vitals/attribution');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (wv as any)._reset as () => void;
}

function makeMockMetric(name: string, value: number) {
  return {
    name,
    value,
    rating:         'good',
    delta:          value,
    id:             `v3-${name}-123`,
    navigationType: 'navigate',
    entries:        [],
  };
}

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let fire: (name: string, m: unknown) => void;

  beforeEach(async () => {
    const reset = await getResetFn();
    reset();
    fire = await getFireFn();
    collector = new MetricsCollector();
    collector.start();
  });

  it('registers all five web-vitals on start()', () => {
    // Firing each metric should populate the snapshot
    fire('LCP',  makeMockMetric('LCP',  2000));
    fire('FCP',  makeMockMetric('FCP',  900));
    fire('CLS',  makeMockMetric('CLS',  0.05));
    fire('INP',  makeMockMetric('INP',  150));
    fire('TTFB', makeMockMetric('TTFB', 400));

    const snap = collector.getSnapshot();
    expect(snap['LCP']?.value).toBe(2000);
    expect(snap['FCP']?.value).toBe(900);
    expect(snap['CLS']?.value).toBe(0.05);
    expect(snap['INP']?.value).toBe(150);
    expect(snap['TTFB']?.value).toBe(400);
  });

  it('does not register twice when start() called multiple times', async () => {
    const reset = await getResetFn();
    reset();
    const sub: Mock = vi.fn();
    collector = new MetricsCollector();
    collector.start();
    collector.start(); // second call should be no-op
    collector.subscribe(sub);
    fire('LCP', makeMockMetric('LCP', 1000));
    expect(sub).toHaveBeenCalledOnce();
  });

  it('subscribe callback fires with enriched RawMetricValue', () => {
    const cb: Mock = vi.fn();
    collector.subscribe(cb);

    fire('LCP', makeMockMetric('LCP', 2500));

    expect(cb).toHaveBeenCalledOnce();
    const metric = cb.mock.calls[0]?.[0];
    expect(metric?.name).toBe('LCP');
    expect(metric?.value).toBe(2500);
    expect(metric?.rating).toBe('good');
    expect(metric?.navigationType).toBe('navigate');
    expect(Array.isArray(metric?.entries)).toBe(true);
  });

  it('subscribe returns an unsubscribe function', () => {
    const cb: Mock = vi.fn();
    const unsub = collector.subscribe(cb);
    unsub();
    fire('LCP', makeMockMetric('LCP', 1000));
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple subscribers all receive the event', () => {
    const cb1: Mock = vi.fn();
    const cb2: Mock = vi.fn();
    collector.subscribe(cb1);
    collector.subscribe(cb2);
    fire('FCP', makeMockMetric('FCP', 800));
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('getSnapshot returns a shallow copy', () => {
    fire('LCP', makeMockMetric('LCP', 1800));
    const snap1 = collector.getSnapshot();
    const snap2 = collector.getSnapshot();
    expect(snap1).not.toBe(snap2);
    expect(snap1['LCP']).toEqual(snap2['LCP']);
  });

  it('snapshot holds latest value when metric fires multiple times', () => {
    fire('CLS', makeMockMetric('CLS', 0.05));
    fire('CLS', makeMockMetric('CLS', 0.12));
    expect(collector.getSnapshot()['CLS']?.value).toBe(0.12);
  });

  it('reset() clears all snapshot values', () => {
    fire('LCP', makeMockMetric('LCP', 2000));
    fire('FCP', makeMockMetric('FCP', 800));
    collector.reset();
    const snap = collector.getSnapshot();
    expect(snap['LCP']).toBeUndefined();
    expect(snap['FCP']).toBeUndefined();
  });

  it('reset() does not affect new metrics after reset', () => {
    fire('LCP', makeMockMetric('LCP', 2000));
    collector.reset();
    fire('CLS', makeMockMetric('CLS', 0.1));
    const snap = collector.getSnapshot();
    expect(snap['LCP']).toBeUndefined();
    expect(snap['CLS']?.value).toBe(0.1);
  });
});
