import { describe, it, expect, vi, afterEach } from 'vitest';
import { init } from '../../../src/core.js';
import type { ClientConfig, StorageAdapter } from '@vitalsage/types';

function makeConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    storage: { adapter: {} },
    ...overrides,
  };
}

// Reset the activeInstance singleton between tests by calling stop()
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('init()', () => {
  it('returns NOOP_INSTANCE when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    const instance = init(makeConfig());
    expect(instance.stop).toBeTypeOf('function');
    expect(() => instance.stop()).not.toThrow();
  });

  it('returns a VitalSageInstance with stop()', () => {
    const instance = init(makeConfig());
    expect(instance).toHaveProperty('stop');
    instance.stop();
  });

  it('returns singleton when called twice without stop()', () => {
    const inst1 = init(makeConfig());
    const inst2 = init(makeConfig());
    expect(inst1).toBe(inst2);
    inst1.stop();
  });

  it('warns on double init when debug: true', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inst1 = init(makeConfig({ debug: true }));
    init(makeConfig({ debug: true }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[VitalSage]'));
    inst1.stop();
  });

  it('can reinitialize after stop()', () => {
    const inst1 = init(makeConfig());
    inst1.stop();
    const inst2 = init(makeConfig());
    expect(inst2).not.toBe(inst1);
    inst2.stop();
  });

  it('returns NOOP_INSTANCE when sampling is 0', () => {
    // sampling = 0 means Math.random() (always > 0) > sampling → noop
    const instance = init(makeConfig({ sampling: 0 }));
    // It should still have a valid stop() fn
    expect(() => instance.stop()).not.toThrow();
    // sampling=0 never starts a real instance, so stop() call is safe (no activeInstance set)
  });

  it('onReport fires when pagehide event dispatched', () => {
    const onReport = vi.fn();
    const adapter: StorageAdapter = { onReport };
    const instance = init(makeConfig({ storage: { adapter } }));

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

    expect(onReport).toHaveBeenCalledOnce();
    const report = onReport.mock.calls[0][0];
    expect(report).toHaveProperty('sessionId');
    expect(report).toHaveProperty('visitId');
    expect(report).toHaveProperty('route');
    expect(report.synthetic).toBe(false);
    expect(report.sdkVersion).toBe('__VERSION__');

    instance.stop();
  });

  it('onReport is not called when adapter has none', () => {
    const instance = init(makeConfig({ storage: { adapter: {} } }));
    expect(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    }).not.toThrow();
    instance.stop();
  });

  it('stop() clears activeInstance so next init() works', () => {
    const inst1 = init(makeConfig());
    inst1.stop();
    const inst2 = init(makeConfig());
    expect(inst2).not.toBe(inst1);
    inst2.stop();
  });
});
