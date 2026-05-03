import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectDeviceContext } from '../../../src/collector/device.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubNavigator(overrides: Record<string, unknown>) {
  vi.stubGlobal('navigator', { ...navigator, ...overrides });
}

function stubWindow(overrides: Record<string, unknown>) {
  vi.stubGlobal('window', { ...window, ...overrides });
}

describe('collectDeviceContext — basic fields', () => {
  it('captures userAgent, viewport, devicePixelRatio, hardwareConcurrency', () => {
    stubNavigator({ userAgent: 'TestAgent/1.0', hardwareConcurrency: 4 });
    vi.stubGlobal('window', { ...window, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2 });

    const ctx = collectDeviceContext();

    expect(ctx.userAgent).toBe('TestAgent/1.0');
    expect(ctx.viewport).toEqual({ width: 1440, height: 900 });
    expect(ctx.devicePixelRatio).toBe(2);
    expect(ctx.hardwareConcurrency).toBe(4);
  });

  it('includes deviceMemory when present', () => {
    stubNavigator({ deviceMemory: 8 });
    expect(collectDeviceContext().deviceMemory).toBe(8);
  });

  it('omits deviceMemory when absent', () => {
    stubNavigator({ deviceMemory: undefined });
    expect('deviceMemory' in collectDeviceContext()).toBe(false);
  });
});

describe('collectDeviceContext — device category', () => {
  it('classifies desktop UA', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    expect(collectDeviceContext().deviceCategory).toBe('desktop');
  });

  it('classifies iPhone as mobile', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
    expect(collectDeviceContext().deviceCategory).toBe('mobile');
  });

  it('classifies Android phone as mobile', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile' });
    expect(collectDeviceContext().deviceCategory).toBe('mobile');
  });

  it('classifies iPad as tablet', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' });
    expect(collectDeviceContext().deviceCategory).toBe('tablet');
  });

  it('classifies Android tablet (no Mobile keyword) as tablet via Silk', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit Silk/95.3.3' });
    expect(collectDeviceContext().deviceCategory).toBe('tablet');
  });
});

describe('collectDeviceContext — connection', () => {
  it('returns unknown when connection API is absent', () => {
    stubNavigator({ connection: undefined, mozConnection: undefined, webkitConnection: undefined });
    expect(collectDeviceContext().connection.type).toBe('unknown');
  });

  it('maps effectiveType "4g" → "4g"', () => {
    stubNavigator({ connection: { effectiveType: '4g', downlink: 10, rtt: 50 } });
    expect(collectDeviceContext().connection.type).toBe('4g');
  });

  it('maps effectiveType "3g" → "3g"', () => {
    stubNavigator({ connection: { effectiveType: '3g' } });
    expect(collectDeviceContext().connection.type).toBe('3g');
  });

  it('maps effectiveType "2g" → "2g"', () => {
    stubNavigator({ connection: { effectiveType: '2g' } });
    expect(collectDeviceContext().connection.type).toBe('2g');
  });

  it('maps effectiveType "slow-2g" → "slow-2g"', () => {
    stubNavigator({ connection: { effectiveType: 'slow-2g' } });
    expect(collectDeviceContext().connection.type).toBe('slow-2g');
  });

  it('maps type "wifi" → "wifi"', () => {
    stubNavigator({ connection: { type: 'wifi', effectiveType: '4g' } });
    expect(collectDeviceContext().connection.type).toBe('wifi');
  });

  it('maps type "ethernet" → "ethernet"', () => {
    stubNavigator({ connection: { type: 'ethernet' } });
    expect(collectDeviceContext().connection.type).toBe('ethernet');
  });

  it('includes downlink and rtt when present', () => {
    stubNavigator({ connection: { effectiveType: '4g', downlink: 20, rtt: 30 } });
    const ctx = collectDeviceContext();
    expect(ctx.connection.downlink).toBe(20);
    expect(ctx.connection.rtt).toBe(30);
  });

  it('includes saveData when present', () => {
    stubNavigator({ connection: { effectiveType: '3g', saveData: true } });
    expect(collectDeviceContext().connection.saveData).toBe(true);
  });

  it('omits effectiveType when absent', () => {
    stubNavigator({ connection: { type: 'wifi' } });
    expect('effectiveType' in collectDeviceContext().connection).toBe(false);
  });

  it('falls back to window.devicePixelRatio = 1 when undefined', () => {
    stubWindow({ ...window, devicePixelRatio: undefined });
    expect(collectDeviceContext().devicePixelRatio).toBe(1);
  });
});
