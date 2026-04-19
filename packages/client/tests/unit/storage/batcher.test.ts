import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricBatcher } from '../../../src/storage/batcher.js';
import type { MetricDataPoint } from '@vitalsage/types';

function makePoint(name = 'LCP'): MetricDataPoint {
  return {
    sessionId:      'session-1',
    visitId:        'visit-1',
    name:           name as MetricDataPoint['name'],
    value:          1200,
    rating:         'good',
    delta:          1200,
    route:          { pattern: '/', path: '/', visitId: 'v1', navigationIndex: 0 },
    timestamp:      Date.now(),
    navigationType: 'navigate',
  };
}

describe('MetricBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes when maxSize is reached', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 3, flushInterval: 5000 }, onFlush);

    batcher.add(makePoint('LCP'));
    batcher.add(makePoint('FCP'));
    expect(onFlush).not.toHaveBeenCalled();
    batcher.add(makePoint('CLS'));
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(3);
  });

  it('flushes after interval when below maxSize', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 10, flushInterval: 5000 }, onFlush);

    batcher.add(makePoint());
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(1);
  });

  it('does not set a second timer when more items added before flush', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 10, flushInterval: 5000 }, onFlush);

    batcher.add(makePoint('LCP'));
    batcher.add(makePoint('FCP')); // should not reset timer
    vi.advanceTimersByTime(5000);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(2);
  });

  it('does not flush empty buffer', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 3, flushInterval: 5000 }, onFlush);
    batcher.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('explicit flush clears the buffer', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 10, flushInterval: 5000 }, onFlush);
    batcher.add(makePoint());
    batcher.flush();
    expect(onFlush).toHaveBeenCalledOnce();
    // Second flush should not fire again
    batcher.flush();
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('explicit flush cancels pending timer', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 10, flushInterval: 5000 }, onFlush);
    batcher.add(makePoint());
    batcher.flush(); // clears timer
    vi.advanceTimersByTime(10000);
    expect(onFlush).toHaveBeenCalledOnce(); // timer did not fire again
  });

  it('destroy() flushes remaining items', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 10, flushInterval: 5000 }, onFlush);
    batcher.add(makePoint('LCP'));
    batcher.add(makePoint('FCP'));
    batcher.destroy();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(2);
  });

  it('destroy() cancels timer after flush', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 10, flushInterval: 5000 }, onFlush);
    batcher.add(makePoint());
    batcher.destroy();
    vi.advanceTimersByTime(10000);
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('uses defaults for maxSize and flushInterval', () => {
    const onFlush = vi.fn();
    // Default maxSize is 10, flushInterval is 5000
    const batcher = new MetricBatcher({ enabled: true }, onFlush);

    for (let i = 0; i < 9; i++) batcher.add(makePoint());
    expect(onFlush).not.toHaveBeenCalled();

    batcher.add(makePoint());
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('resets timer properly after a size-triggered flush', () => {
    const onFlush = vi.fn();
    const batcher = new MetricBatcher({ enabled: true, maxSize: 2, flushInterval: 5000 }, onFlush);

    batcher.add(makePoint());
    batcher.add(makePoint()); // triggers size flush
    expect(onFlush).toHaveBeenCalledOnce();

    // Add again — should start new timer
    batcher.add(makePoint());
    vi.advanceTimersByTime(5000);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});
