import type {
  PageContext, ResourceEntry, LCPElementDescriptor, ImageEntry,
  FontEntry, ScriptEntry, StylesheetEntry, ResourceHintEntry, SerializablePerformanceEntry,
} from '@vitalsage/types';
import { collectNavigationTiming } from './navigation-timing.js';

const HINT_RELS = ['preload', 'preconnect', 'dns-prefetch', 'prefetch', 'modulepreload'] as const;

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
      hints:            this.collectHints(),
      navigationTiming: collectNavigationTiming(),
    };
  }

  private collectHints(): ResourceHintEntry[] {
    const out: ResourceHintEntry[] = [];
    for (const rel of HINT_RELS) {
      for (const l of Array.from(document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))) {
        if (!l.href) continue;
        out.push({
          rel,
          href: l.href,
          ...(l.getAttribute('as') ? { as: l.getAttribute('as')! } : {}),
          ...(l.hasAttribute('crossorigin') ? { crossOrigin: true } : {}),
        });
      }
    }
    return out;
  }

  /** transferSize for an external resource, joined from the resource timeline. */
  private resourceSize(url: string | undefined, resources: PerformanceResourceTiming[]): number | undefined {
    if (!url) return undefined;
    const entry = resources.find(r => r.name === url);
    return entry && entry.transferSize > 0 ? entry.transferSize : undefined;
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
    // Map absolute preload href → whether the link carries crossorigin.
    // Font preloads are always CORS requests: a preload without crossorigin
    // is fetched twice, so the attribute (not the URL origin) is the signal.
    const preloadLinks = new Map(
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]'))
        .map(l => [l.href, l.hasAttribute('crossorigin')] as const),
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
          // Resolve relative CSS urls against the stylesheet so comparisons
          // with absolute link.href values match.
          const url = urlMatch?.[1]
            ? (() => { try { return new URL(urlMatch[1]!, sheet.href ?? location.href).href; } catch { return undefined; } })()
            : undefined;

          entries.push({
            family,
            display,
            ...(url ? { url } : {}),
            isPreloaded:    url ? preloadLinks.has(url) : false,
            hasCrossOrigin: url ? (preloadLinks.get(url) ?? false) : false,
            ...(url ? { isCrossOrigin: (() => { try { return new URL(url).origin !== location.origin; } catch { return false; } })() } : {}),
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
    const scripts   = Array.from(document.querySelectorAll<HTMLScriptElement>('script'));
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return scripts.map(s => {
      const isModule         = s.type === 'module';
      const isDeferred       = s.defer || isModule;
      const isAsync          = s.async;
      const isInline         = !s.src;
      const inHead           = s.closest('head') !== null;
      const isRenderBlocking = !isInline && inHead && !isAsync && !isDeferred;
      const size = isInline
        ? s.textContent?.length ?? 0
        : this.resourceSize(s.src, resources);

      return {
        ...(s.src ? { src: s.src } : {}),
        isInline,
        isDeferred,
        isAsync,
        isModule,
        isRenderBlocking,
        ...(size !== undefined ? { size } : {}),
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
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return links.map(l => {
      const transferSize = this.resourceSize(l.href, resources);
      return {
        ...(l.href ? { href: l.href } : {}),
        isInline:         false,
        isRenderBlocking: !l.media || l.media === 'all' || l.media === 'screen',
        ...(l.media ? { media: l.media } : {}),
        ...(transferSize !== undefined ? { transferSize } : {}),
        isThirdParty: l.href
          ? (() => { try { return new URL(l.href).origin !== location.origin; } catch { return false; } })()
          : false,
      };
    });
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
