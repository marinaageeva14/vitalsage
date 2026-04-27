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

  it('onInteraction fires when pagehide event dispatched', () => {
    const onInteraction = vi.fn();
    const adapter: StorageAdapter = { onInteraction };
    const instance = init(makeConfig({ storage: { adapter } }));

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

    expect(onInteraction).toHaveBeenCalledOnce();
    const interaction = onInteraction.mock.calls[0][0];
    expect(interaction).toHaveProperty('id');
    expect(interaction).toHaveProperty('type');
    expect(interaction).toHaveProperty('status');
    expect(interaction.type).toBe('INITIAL_LOAD');
    expect(interaction.status).toBe('success');

    instance.stop();
  });

  it('page.traceMetrics is included when longtask observer is supported', () => {
    const onInteraction = vi.fn();
    const adapter: StorageAdapter = { onInteraction };

    // Simulate PerformanceObserver support for longtask
    const mockObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));
    mockObserver.supportedEntryTypes = ['longtask'];
    vi.stubGlobal('PerformanceObserver', mockObserver);

    const instance = init(makeConfig({ storage: { adapter } }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

    expect(onInteraction).toHaveBeenCalledOnce();
    const interaction = onInteraction.mock.calls[0][0];
    // page should be present (status is success)
    expect(interaction.page).toBeDefined();
    // traceMetrics present because observer was active
    expect(interaction.page?.traceMetrics).toBeDefined();
    expect(interaction.page?.traceMetrics).toHaveProperty('totalBlockingTime');
    expect(interaction.page?.traceMetrics).toHaveProperty('longTaskCount');
    expect(interaction.page?.traceMetrics).toHaveProperty('domNodes');

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
