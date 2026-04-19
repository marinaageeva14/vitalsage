import type {
  PageContext, ResourceEntry, LCPElementDescriptor, ImageEntry,
  FontEntry, ScriptEntry, StylesheetEntry, SerializablePerformanceEntry,
} from '@vitalsage/types';
import { collectNavigationTiming } from './navigation-timing.js';

export class ContextCollector {

  collect(lcpEntries?: SerializablePerformanceEntry[]): PageContext {
    const lcpElement = this.findLcpElement(lcpEntries);
    return {
      url:              location.href,
      referrer:         document.referrer,
      title:            document.title,
      domNodeCount:     document.querySelectorAll('*').length,
      resources:        this.collectResources(),
      ...(lcpElement ? { lcpElement } : {}),
      fonts:            this.collectFonts(),
      images:           this.collectImages(lcpElement),
      scripts:          this.collectScripts(),
      stylesheets:      this.collectStylesheets(),
      navigationTiming: collectNavigationTiming(),
    };
  }

  private collectResources(): ResourceEntry[] {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return entries
      .slice(0, 250)
      .map(e => ({
        name:                 e.name,
        initiatorType:        e.initiatorType,
        duration:             e.duration,
        transferSize:         e.transferSize,
        encodedBodySize:      e.encodedBodySize,
        decodedBodySize:      e.decodedBodySize,
        renderBlockingStatus: this.getRenderBlockingStatus(e),
        fetchStart:           e.fetchStart,
        responseEnd:          e.responseEnd,
        fromCache:            e.transferSize === 0 && e.decodedBodySize > 0,
      }));
  }

  private getRenderBlockingStatus(
    entry: PerformanceResourceTiming,
  ): 'blocking' | 'non-blocking' | 'unknown' {
    // Chrome 107+ exposes this natively
    if ('renderBlockingStatus' in entry) {
      return (entry as unknown as { renderBlockingStatus: 'blocking' | 'non-blocking' }).renderBlockingStatus;
    }
    return 'unknown';
  }

  private findLcpElement(
    entries?: SerializablePerformanceEntry[],
  ): LCPElementDescriptor | undefined {
    if (!entries?.length) return undefined;

    const last = entries[entries.length - 1];
    if (!last?.element) return undefined;

    const imgEl = last.url
      ? (this.findImageByUrl(last.url))
      : null;

    const currentOrigin = location.origin;
    const elementOrigin = last.url
      ? (() => { try { return new URL(last.url).origin; } catch { return currentOrigin; } })()
      : currentOrigin;

    return {
      tagName:               (last.element as string).split('#')[0] ?? 'UNKNOWN',
      ...(last.url ? { src: last.url } : {}),
      isThirdParty:          elementOrigin !== currentOrigin,
      ...(imgEl?.getAttribute('fetchpriority') != null
        ? { fetchPriority: imgEl.getAttribute('fetchpriority') as string } : {}),
      ...(imgEl?.getAttribute('loading') != null
        ? { loading: imgEl.getAttribute('loading') as string } : {}),
      hasExplicitDimensions: imgEl
        ? (!!imgEl.getAttribute('width') && !!imgEl.getAttribute('height'))
        : false,
      ...(imgEl?.naturalWidth  ? { naturalWidth:  imgEl.naturalWidth }  : {}),
      ...(imgEl?.naturalHeight ? { naturalHeight: imgEl.naturalHeight } : {}),
      ...(() => {
        if (!imgEl) return {};
        const rect = imgEl.getBoundingClientRect();
        return {
          ...(rect.width  ? { displayWidth:  rect.width }  : {}),
          ...(rect.height ? { displayHeight: rect.height } : {}),
        };
      })(),
      isPreloaded:           this.isResourcePreloaded(last.url ?? ''),
      elementType:           this.inferElementType(last),
    };
  }

  private findImageByUrl(url: string): HTMLImageElement | null {
    try {
      const pathname = new URL(url).pathname;
      return (
        document.querySelector<HTMLImageElement>(`img[src="${CSS.escape(url)}"]`) ??
        document.querySelector<HTMLImageElement>(`img[src*="${CSS.escape(pathname)}"]`)
      );
    } catch {
      return null;
    }
  }

  private isResourcePreloaded(url: string): boolean {
    if (!url) return false;
    const preloads = document.querySelectorAll<HTMLLinkElement>('link[rel="preload"]');
    return Array.from(preloads).some(l => {
      try {
        return new URL(l.href).pathname === new URL(url).pathname;
      } catch { return false; }
    });
  }

  private inferElementType(entry: SerializablePerformanceEntry): LCPElementDescriptor['elementType'] {
    const tag = (entry.element as string | undefined)?.split('#')[0]?.toUpperCase();
    if (tag === 'IMG')   return 'img';
    if (tag === 'VIDEO') return 'video';
    if (tag === 'SVG')   return 'svg';
    if (entry.url)       return 'background-image';
    return 'text';
  }

  private collectFonts(): FontEntry[] {
    const entries: FontEntry[] = [];
    const preloadedUrls = new Set(
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]'))
        .map(l => l.href),
    );
    const ICON_FONT_FAMILIES = ['Font Awesome', 'Material Icons', 'Ionicons', 'Glyphicons', 'Icons'];

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = Array.from(sheet.cssRules ?? []);
        for (const rule of rules) {
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const fontRule = rule as CSSFontFaceRule;
          const family  = fontRule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
          const display = fontRule.style.getPropertyValue('font-display').trim() || 'auto';
          const srcRaw  = fontRule.style.getPropertyValue('src');
          const urlMatch    = /url\(["']?([^"')]+)["']?\)/.exec(srcRaw);
          const formatMatch = /format\(["']?([^"')]+)["']?\)/.exec(srcRaw);
          const url = urlMatch?.[1];

          entries.push({
            family,
            display,
            ...(url ? { url } : {}),
            isPreloaded:    url ? preloadedUrls.has(url) : false,
            hasCrossOrigin: url
              ? (() => { try { return new URL(url).origin !== location.origin; } catch { return false; } })()
              : false,
            ...(formatMatch?.[1] ? { format: formatMatch[1] } : {}),
            isSystemFont: false,
            isIconFont:   ICON_FONT_FAMILIES.some(f => family.includes(f)),
          });
        }
      } catch {
        // Cross-origin stylesheet — SecurityError. Skip.
        continue;
      }
    }

    return entries;
  }

  private collectImages(lcpEl?: LCPElementDescriptor): ImageEntry[] {
    const imgs      = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
    const viewportH = window.innerHeight;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    return imgs.map(img => {
      const rect        = img.getBoundingClientRect();
      const isAboveFold = rect.top < viewportH && rect.bottom > 0;
      const resourceEntry = resources.find(r => {
        try { return new URL(r.name).pathname === new URL(img.src).pathname; }
        catch { return false; }
      });
      const format    = inferFormat(img.src);
      const hasSrcset = img.hasAttribute('srcset') || img.closest('picture') !== null;

      const isLCP = lcpEl?.src
        ? (() => { try { return new URL(img.src).pathname === new URL(lcpEl.src!).pathname; } catch { return false; } })()
        : false;

      return {
        src:                   img.src,
        isLCP,
        isAboveFold,
        hasExplicitDimensions: !!img.getAttribute('width') && !!img.getAttribute('height'),
        ...(img.getAttribute('loading')      != null ? { loading:      img.getAttribute('loading') as string }      : {}),
        ...(img.getAttribute('fetchpriority') != null ? { fetchPriority: img.getAttribute('fetchpriority') as string } : {}),
        ...(img.naturalWidth  ? { naturalWidth:  img.naturalWidth }  : {}),
        ...(img.naturalHeight ? { naturalHeight: img.naturalHeight } : {}),
        ...(rect.width        ? { displayWidth:  rect.width }        : {}),
        ...(rect.height       ? { displayHeight: rect.height }       : {}),
        ...(resourceEntry?.transferSize !== undefined ? { transferSize: resourceEntry.transferSize } : {}),
        ...(format ? { format } : {}),
        isResponsive: hasSrcset,
        isFromCache:  resourceEntry
          ? (resourceEntry.transferSize === 0 && resourceEntry.decodedBodySize > 0)
          : false,
      };
    });
  }

  private collectScripts(): ScriptEntry[] {
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script'));
    return scripts.map(s => {
      const isModule         = s.type === 'module';
      const isDeferred       = s.defer || isModule;
      const isAsync          = s.async;
      const isInline         = !s.src;
      const inHead           = s.closest('head') !== null;
      const isRenderBlocking = !isInline && inHead && !isAsync && !isDeferred;

      return {
        ...(s.src ? { src: s.src } : {}),
        isInline,
        isDeferred,
        isAsync,
        isModule,
        isRenderBlocking,
        ...(isInline ? { size: s.textContent?.length ?? 0 } : {}),
        position:    inHead ? 'head' : 'body',
        isThirdParty: s.src
          ? (() => { try { return new URL(s.src).origin !== location.origin; } catch { return false; } })()
          : false,
      };
    });
  }

  private collectStylesheets(): StylesheetEntry[] {
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    );
    return links.map(l => ({
      ...(l.href ? { href: l.href } : {}),
      isInline:         false,
      isRenderBlocking: !l.media || l.media === 'all' || l.media === 'screen',
      ...(l.media ? { media: l.media } : {}),
      isThirdParty: l.href
        ? (() => { try { return new URL(l.href).origin !== location.origin; } catch { return false; } })()
        : false,
    }));
  }
}

function inferFormat(src: string): string | undefined {
  try {
    const ext = new URL(src).pathname.split('.').pop()?.toLowerCase();
    if (['avif', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico'].includes(ext ?? '')) {
      return ext;
    }
  } catch { /* data: URI or invalid URL */ }
  return undefined;
}
