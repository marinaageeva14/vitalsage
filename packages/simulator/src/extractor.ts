import type { Page } from 'playwright';
import type {
  SessionReport,
  PageContext,
  NavigationTimingSnapshot,
  CoreWebVitals,
  NetworkProfile,
  ViewportProfile,
} from '@vitalsage/types';
import { VIEWPORT_PROFILES } from './profiles.js';

interface PerfsageSession {
  metrics: Record<string, unknown>;
  startTime: number;
}

declare global {
  interface Window {
    __vitalsage_session: PerfsageSession;
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function extractSessionReport(
  page:            Page,
  url:             string,
  networkProfile:  NetworkProfile,
  viewportProfile: ViewportProfile,
  sessionId:       string,
): Promise<SessionReport> {
  await page.waitForTimeout(500);

  const session     = await page.evaluate(() => window.__vitalsage_session);
  const navTiming   = await page.evaluate(extractNavTiming);
  const pageContext = await page.evaluate(collectPageContext);
  const userAgent   = await page.evaluate(() => navigator.userAgent);

  const ttfbValue = navTiming.serverTime + navTiming.tlsTime + navTiming.dnsTime + navTiming.redirectTime;
  if (ttfbValue > 0) {
    (session.metrics as CoreWebVitals).TTFB = {
      name:           'TTFB',
      value:          ttfbValue,
      rating:         ttfbValue <= 800 ? 'good' : ttfbValue <= 1800 ? 'needs-improvement' : 'poor',
      delta:          ttfbValue,
      id:             'sim-ttfb',
      navigationType: 'navigate',
      entries:        [],
    };
  }

  const viewport = VIEWPORT_PROFILES[viewportProfile];
  const visitId  = generateId();

  return {
    sessionId,
    visitId,
    route: {
      pattern:         '/**',
      path:            new URL(url).pathname,
      visitId,
      navigationIndex: 0,
    },
    url,
    timestamp:  Date.now(),
    device: {
      userAgent,
      viewport:            { width: viewport.width, height: viewport.height },
      devicePixelRatio:    viewport.deviceScaleFactor,
      hardwareConcurrency: 4,
      deviceCategory:      viewportProfile === 'mobile' ? 'mobile' : viewportProfile === 'tablet' ? 'tablet' : 'desktop',
      connection:          { type: networkProfile === 'wifi' ? 'wifi' : networkProfile },
      simulated:           { networkProfile, viewportProfile },
    },
    page:       pageContext,
    metrics:    session.metrics as CoreWebVitals,
    synthetic:  true,
    sdkVersion: '__VERSION__',
  };
}

// Runs inside the browser — must be self-contained
function extractNavTiming(): NavigationTimingSnapshot {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) {
    return {
      redirectTime:    0, dnsTime:      0, tlsTime:         0, serverTime:  0,
      downloadTime:    0, domParseTime: 0, totalLoadTime:   0, workerTime:  0,
      isServiceWorker: false, redirectCount: 0,
    };
  }
  return {
    redirectTime:    nav.redirectEnd - nav.redirectStart,
    dnsTime:         nav.domainLookupEnd - nav.domainLookupStart,
    tlsTime:         nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
    serverTime:      Math.max(0, nav.responseStart - nav.requestStart),
    downloadTime:    nav.responseEnd - nav.responseStart,
    domParseTime:    nav.domInteractive - nav.responseEnd,
    totalLoadTime:   nav.loadEventEnd - nav.startTime,
    workerTime:      nav.workerStart > 0 ? nav.responseStart - nav.workerStart : 0,
    isServiceWorker: nav.workerStart > 0,
    redirectCount:   nav.redirectCount,
  };
}

// Runs inside the browser — collects PageContext
function collectPageContext(): PageContext {
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

  const lcpEntries = performance.getEntriesByType('largest-contentful-paint') as PerformancePaintTiming[];
  const lastLcp    = lcpEntries[lcpEntries.length - 1] as (PerformancePaintTiming & { element?: Element; url?: string; size?: number }) | undefined;

  return {
    url:          location.href,
    referrer:     document.referrer,
    title:        document.title,
    domNodeCount: document.querySelectorAll('*').length,

    resources: resources.map(r => ({
      name:                 r.name,
      initiatorType:        r.initiatorType,
      duration:             r.duration,
      transferSize:         r.transferSize,
      encodedBodySize:      r.encodedBodySize,
      decodedBodySize:      r.decodedBodySize,
      renderBlockingStatus: (r as unknown as { renderBlockingStatus?: string }).renderBlockingStatus === 'blocking'
        ? 'blocking'
        : (r as unknown as { renderBlockingStatus?: string }).renderBlockingStatus === 'non-blocking'
          ? 'non-blocking'
          : 'unknown',
      fetchStart:   r.fetchStart,
      responseEnd:  r.responseEnd,
      fromCache:    r.transferSize === 0 && r.decodedBodySize > 0,
    })),

    ...(lastLcp?.element ? { lcpElement: (() => {
      const el   = lastLcp.element!;
      const tag  = el.tagName.toLowerCase() as 'img' | 'text' | 'background-image' | 'video' | 'svg';
      const src  = el instanceof HTMLImageElement ? el.currentSrc : (lastLcp.url ?? undefined);
      const rect = el.getBoundingClientRect();
      const nw   = el instanceof HTMLImageElement ? el.naturalWidth  : undefined;
      const nh   = el instanceof HTMLImageElement ? el.naturalHeight : undefined;
      const fp   = el instanceof HTMLImageElement ? (el.fetchPriority || undefined) : undefined;
      const ld   = el instanceof HTMLImageElement ? (el.loading || undefined) : undefined;
      return {
        tagName:               el.tagName,
        ...(src ? { src } : {}),
        isThirdParty:          src ? (() => { try { return new URL(src).origin !== location.origin; } catch { return false; } })() : false,
        hasExplicitDimensions: el.hasAttribute('width') && el.hasAttribute('height'),
        isPreloaded:           !!document.querySelector('link[rel="preload"][as="image"]'),
        elementType:           tag === 'img' ? 'img' as const : 'text' as const,
        displayWidth:          Math.round(rect.width),
        displayHeight:         Math.round(rect.height),
        ...(nw !== undefined ? { naturalWidth:  nw } : {}),
        ...(nh !== undefined ? { naturalHeight: nh } : {}),
        ...(fp !== undefined ? { fetchPriority: fp } : {}),
        ...(ld !== undefined ? { loading:       ld } : {}),
      };
    })() } : {}),

    fonts: Array.from(document.fonts as unknown as Iterable<FontFace>).map(font => ({
      family:         font.family.replace(/['"]/g, '').trim(),
      display:        'auto',
      isPreloaded:    false,
      hasCrossOrigin: false,
      isSystemFont:   false,
      isIconFont:     /icon|material|awesome/i.test(font.family),
    })),

    images: Array.from(document.querySelectorAll('img')).map(img => {
      const rect = img.getBoundingClientRect();
      const isAboveFold = rect.top < window.innerHeight;
      const nw = img.naturalWidth  || undefined;
      const nh = img.naturalHeight || undefined;
      const dw = Math.round(rect.width)  || undefined;
      const dh = Math.round(rect.height) || undefined;
      return {
        src:                   img.currentSrc || img.src,
        isLCP:                 lastLcp?.element === img,
        isAboveFold,
        hasExplicitDimensions: img.hasAttribute('width') && img.hasAttribute('height'),
        ...(img.loading      ? { loading:       img.loading      } : {}),
        ...(img.fetchPriority ? { fetchPriority: img.fetchPriority } : {}),
        ...(nw !== undefined ? { naturalWidth:  nw } : {}),
        ...(nh !== undefined ? { naturalHeight: nh } : {}),
        ...(dw !== undefined ? { displayWidth:  dw } : {}),
        ...(dh !== undefined ? { displayHeight: dh } : {}),
        isResponsive: img.srcset !== '' || img.sizes !== '',
        isFromCache:  false,
      };
    }),

    scripts: Array.from(document.querySelectorAll('script[src]')).map(script => {
      const s   = script as HTMLScriptElement;
      const src = s.src;
      return {
        ...(src ? { src } : {}),
        isInline:         false,
        isDeferred:       s.defer,
        isAsync:          s.async,
        isModule:         s.type === 'module',
        isRenderBlocking: !s.defer && !s.async && s.type !== 'module',
        position:         s.closest('head') ? 'head' : 'body',
        isThirdParty:     src ? (() => { try { return new URL(src).origin !== location.origin; } catch { return false; } })() : false,
      } as const;
    }),

    stylesheets: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => {
      const l   = link as HTMLLinkElement;
      const src = l.href;
      return {
        ...(src ? { href: src } : {}),
        isInline:         false,
        isRenderBlocking: !l.media || l.media === 'all',
        ...(l.media ? { media: l.media } : {}),
        isThirdParty:     src ? (() => { try { return new URL(src).origin !== location.origin; } catch { return false; } })() : false,
      };
    }),

    navigationTiming: {
      redirectTime:    0, dnsTime:      0, tlsTime:         0, serverTime:  0,
      downloadTime:    0, domParseTime: 0, totalLoadTime:   0, workerTime:  0,
      isServiceWorker: false, redirectCount: 0,
    },
  };
}
