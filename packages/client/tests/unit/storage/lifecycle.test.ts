import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { LifecycleManager } from '../../../src/storage/lifecycle.js';
import type { SessionReport, StorageAdapter } from '@vitalsage/types';

function makeReport(visitId = 'visit-1'): SessionReport {
  return {
    sessionId:  'session-1',
    visitId,
    route:      { pattern: '/', path: '/', visitId, navigationIndex: 0 },
    url:        'https://example.com/',
    timestamp:  Date.now(),
    device:     {
      deviceCategory: 'desktop',
      viewportWidth:  1280,
      viewportHeight: 720,
      devicePixelRatio: 1,
      language:       'en-US',
    },
    page:       {
      resources: [],
      images:    [],
      fonts:     [],
      scripts:   [],
      stylesheets: [],
    },
    metrics:    {},
    synthetic:  false,
    sdkVersion: '0.1.0',
  };
}

describe('LifecycleManager', () => {
  let onReport: Mock;
  let adapter: StorageAdapter;
  let getReport: Mock;

  beforeEach(() => {
    onReport = vi.fn();
    adapter = { onReport };
    getReport = vi.fn(() => makeReport());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onReport on pagehide event', () => {
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(onReport).toHaveBeenCalledOnce();
  });

  it('calls onReport on visibilitychange to hidden', () => {
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(onReport).toHaveBeenCalledOnce();
  });

  it('does NOT call onReport on visibilitychange when visible', () => {
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    // visibilityState defaults to 'visible' in jsdom
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onReport).not.toHaveBeenCalled();
  });

  it('deduplicates: pagehide + visibilitychange only emit once per visitId', () => {
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(onReport).toHaveBeenCalledOnce();
  });

  it('emitForVisit() sends the report with given visitId', () => {
    const report = makeReport('custom-visit');
    getReport.mockReturnValue(report);
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    mgr.emitForVisit('custom-visit');
    expect(onReport).toHaveBeenCalledWith(report);
  });

  it('emitForVisit() deduplicates: second call with same visitId is no-op', () => {
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    mgr.emitForVisit('visit-1');
    mgr.emitForVisit('visit-1');
    expect(onReport).toHaveBeenCalledOnce();
  });

  it('emitForVisit() allows different visitIds to each emit', () => {
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    getReport.mockReturnValueOnce(makeReport('v1')).mockReturnValueOnce(makeReport('v2'));
    mgr.emitForVisit('v1');
    mgr.emitForVisit('v2');
    expect(onReport).toHaveBeenCalledTimes(2);
  });

  it('does nothing when adapter has no onReport', () => {
    const mgr = new LifecycleManager(getReport, {});
    mgr.attach();
    expect(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    }).not.toThrow();
  });

  it('catches synchronous throw from onReport and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onReport.mockImplementation(() => { throw new Error('sync error'); });
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[VitalSage]'), expect.any(Error));
  });

  it('catches rejected Promise from onReport and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onReport.mockImplementation(() => Promise.reject(new Error('async error')));
    const mgr = new LifecycleManager(getReport, adapter);
    mgr.attach();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    // Wait past all microtasks
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[VitalSage]'), expect.any(Error));
  });
});
