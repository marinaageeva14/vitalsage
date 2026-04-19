import { describe, it, expect } from 'vitest';
import { NETWORK_PROFILES, VIEWPORT_PROFILES } from '../../src/profiles.js';

describe('NETWORK_PROFILES', () => {
  it('has all 5 network profiles', () => {
    expect(Object.keys(NETWORK_PROFILES)).toEqual(['wifi', '4g', '3g', '2g', 'slow-2g']);
  });

  it('each profile has required fields', () => {
    for (const profile of Object.values(NETWORK_PROFILES)) {
      expect(typeof profile.downloadThroughput).toBe('number');
      expect(typeof profile.uploadThroughput).toBe('number');
      expect(typeof profile.latency).toBe('number');
      expect(profile.offline).toBe(false);
    }
  });

  it('wifi is faster than 4g', () => {
    expect(NETWORK_PROFILES['wifi'].downloadThroughput).toBeGreaterThan(NETWORK_PROFILES['4g'].downloadThroughput);
  });

  it('slow-2g has highest latency', () => {
    const latencies = Object.values(NETWORK_PROFILES).map(p => p.latency);
    expect(NETWORK_PROFILES['slow-2g'].latency).toBe(Math.max(...latencies));
  });
});

describe('VIEWPORT_PROFILES', () => {
  it('has all 3 viewport profiles', () => {
    expect(Object.keys(VIEWPORT_PROFILES)).toEqual(['desktop', 'tablet', 'mobile']);
  });

  it('desktop is not mobile', () => {
    expect(VIEWPORT_PROFILES['desktop'].isMobile).toBe(false);
    expect(VIEWPORT_PROFILES['desktop'].hasTouch).toBe(false);
  });

  it('mobile is wider than 320 and smaller than desktop', () => {
    expect(VIEWPORT_PROFILES['mobile'].width).toBeGreaterThan(320);
    expect(VIEWPORT_PROFILES['mobile'].width).toBeLessThan(VIEWPORT_PROFILES['desktop'].width);
  });

  it('mobile has higher deviceScaleFactor than desktop', () => {
    expect(VIEWPORT_PROFILES['mobile'].deviceScaleFactor).toBeGreaterThan(VIEWPORT_PROFILES['desktop'].deviceScaleFactor);
  });
});
