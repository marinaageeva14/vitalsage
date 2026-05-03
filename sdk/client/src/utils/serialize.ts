import type { SerializablePerformanceEntry, SerializableRect } from '@vitalsage/types';

// LargestContentfulPaint, LayoutShift, PerformanceEventTiming are not in all
// TypeScript DOM lib versions — use manual type shapes + runtime duck-typing.
interface LCPEntry extends PerformanceEntry {
  element:    Element | null;
  url:        string;
  loadTime:   number;
  renderTime: number;
}

interface LayoutShiftEntry extends PerformanceEntry {
  value:          number;
  hadRecentInput: boolean;
  sources?:       Array<{
    node:         Node | null;
    currentRect:  { toJSON(): SerializableRect };
    previousRect: { toJSON(): SerializableRect };
  }>;
}

interface EventTimingEntry extends PerformanceEntry {
  processingStart: number;
  processingEnd:   number;
  interactionId?:  number;
}

export function serializeEntry(entry: PerformanceEntry): SerializablePerformanceEntry {
  const base: SerializablePerformanceEntry = {
    entryType: entry.entryType,
    name:      entry.name,
    startTime: entry.startTime,
    duration:  entry.duration,
  };

  if (entry.entryType === 'largest-contentful-paint') {
    const lcp = entry as unknown as LCPEntry;
    return {
      ...base,
      ...(lcp.element ? { element: describeNode(lcp.element) } : {}),
      ...(lcp.url     ? { url: lcp.url }                       : {}),
      loadTime:   lcp.loadTime,
      renderTime: lcp.renderTime,
    };
  }

  if (entry.entryType === 'layout-shift') {
    const cls = entry as unknown as LayoutShiftEntry;
    return {
      ...base,
      value:          cls.value,
      hadRecentInput: cls.hadRecentInput,
      sources: (cls.sources ?? []).map(src => ({
        node:         src.node ? describeNode(src.node) : 'unknown',
        currentRect:  src.currentRect.toJSON(),
        previousRect: src.previousRect.toJSON(),
      })),
    };
  }

  if (entry.entryType === 'event' || entry.entryType === 'first-input') {
    const evt = entry as unknown as EventTimingEntry;
    return {
      ...base,
      processingStart: evt.processingStart,
      processingEnd:   evt.processingEnd,
      ...(evt.interactionId !== undefined ? { interactionId: evt.interactionId } : {}),
    };
  }

  return base;
}

function describeNode(node: Node): string {
  if (node instanceof Element) {
    const cls = node.className
      ? '.' + String(node.className).trim().split(/\s+/)[0]
      : '';
    return `${node.tagName}${node.id ? '#' + node.id : ''}${cls}`;
  }
  return node.nodeName;
}
