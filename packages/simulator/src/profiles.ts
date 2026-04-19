import type { NetworkProfile, ViewportProfile } from '@vitalsage/types';

interface CDPNetworkConditions {
  downloadThroughput: number;
  uploadThroughput:   number;
  latency:            number;
  offline:            boolean;
}

interface PlaywrightViewport {
  width:             number;
  height:            number;
  deviceScaleFactor: number;
  isMobile:          boolean;
  hasTouch:          boolean;
}

export const NETWORK_PROFILES: Record<NetworkProfile, CDPNetworkConditions> = {
  'wifi':    { downloadThroughput: 30  * 1024 * 1024 / 8, uploadThroughput: 15  * 1024 * 1024 / 8, latency: 2,    offline: false },
  '4g':      { downloadThroughput: 4   * 1024 * 1024 / 8, uploadThroughput: 3   * 1024 * 1024 / 8, latency: 20,   offline: false },
  '3g':      { downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8,         latency: 100,  offline: false },
  '2g':      { downloadThroughput: 280 * 1024 / 8,         uploadThroughput: 256 * 1024 / 8,         latency: 800,  offline: false },
  'slow-2g': { downloadThroughput: 50  * 1024 / 8,         uploadThroughput: 30  * 1024 / 8,         latency: 2000, offline: false },
};

export const VIEWPORT_PROFILES: Record<ViewportProfile, PlaywrightViewport> = {
  desktop: { width: 1440, height: 900,  deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  tablet:  { width: 768,  height: 1024, deviceScaleFactor: 2, isMobile: true,  hasTouch: true  },
  mobile:  { width: 390,  height: 844,  deviceScaleFactor: 3, isMobile: true,  hasTouch: true  },
};
