import { describe, it, expect } from 'vitest';
import { serializeEntry } from '../../../src/utils/serialize.js';

function makeBase(entryType: string, overrides: Record<string, unknown> = {}): PerformanceEntry {
  return {
    entryType,
    name:      'test',
    startTime: 100,
    duration:  200,
    toJSON:    () => ({}),
    ...overrides,
  } as unknown as PerformanceEntry;
}

function makeRect() {
  const r = { x: 0, y: 0, width: 100, height: 50, top: 0, right: 100, bottom: 50, left: 0 };
  return { toJSON: () => r };
}

describe('serializeEntry — base entry', () => {
  it('serializes base fields for unknown entry types', () => {
    const result = serializeEntry(makeBase('resource'));
    expect(result.entryType).toBe('resource');
    expect(result.name).toBe('test');
    expect(result.startTime).toBe(100);
    expect(result.duration).toBe(200);
  });

  it('does not add extra fields for unknown types', () => {
    const result = serializeEntry(makeBase('resource'));
    expect(result.element).toBeUndefined();
    expect(result.value).toBeUndefined();
    expect(result.processingStart).toBeUndefined();
  });
});

describe('serializeEntry — LCP (largest-contentful-paint)', () => {
  it('serializes LCP element with id and class', () => {
    const el = document.createElement('img');
    el.id = 'hero';
    el.className = 'hero-img';

    const entry = makeBase('largest-contentful-paint', {
      element: el, url: 'https://example.com/hero.jpg', loadTime: 300, renderTime: 350,
    });
    const result = serializeEntry(entry);

    expect(result.element).toBe('IMG#hero.hero-img');
    expect(result.url).toBe('https://example.com/hero.jpg');
    expect(result.loadTime).toBe(300);
    expect(result.renderTime).toBe(350);
  });

  it('handles LCP element without id or class', () => {
    const el = document.createElement('h1');
    const entry = makeBase('largest-contentful-paint', {
      element: el, url: '', loadTime: 0, renderTime: 50,
    });
    expect(serializeEntry(entry).element).toBe('H1');
  });

  it('handles null LCP element → undefined', () => {
    const entry = makeBase('largest-contentful-paint', {
      element: null, url: '', loadTime: 0, renderTime: 100,
    });
    expect(serializeEntry(entry).element).toBeUndefined();
  });

  it('handles empty url → undefined', () => {
    const entry = makeBase('largest-contentful-paint', {
      element: null, url: '', loadTime: 0, renderTime: 100,
    });
    expect(serializeEntry(entry).url).toBeUndefined();
  });
});

describe('serializeEntry — CLS (layout-shift)', () => {
  it('serializes CLS-specific fields with real element source', () => {
    const el = document.createElement('div');
    el.id = 'ad';

    const entry = makeBase('layout-shift', {
      value:          0.15,
      hadRecentInput: false,
      sources: [{ node: el, currentRect: makeRect(), previousRect: makeRect() }],
    });
    const result = serializeEntry(entry);

    expect(result.value).toBe(0.15);
    expect(result.hadRecentInput).toBe(false);
    expect(result.sources).toHaveLength(1);
    expect(result.sources![0]!.node).toBe('DIV#ad');
    expect(result.sources![0]!.currentRect).toEqual(makeRect().toJSON());
  });

  it('handles missing sources (older Chrome) → empty array', () => {
    const entry = makeBase('layout-shift', {
      value: 0.1, hadRecentInput: true, sources: undefined,
    });
    expect(serializeEntry(entry).sources).toEqual([]);
  });

  it('handles null source node → "unknown"', () => {
    const entry = makeBase('layout-shift', {
      value: 0.05, hadRecentInput: false,
      sources: [{ node: null, currentRect: makeRect(), previousRect: makeRect() }],
    });
    expect(serializeEntry(entry).sources![0]!.node).toBe('unknown');
  });

  it('returns nodeName for non-Element nodes (e.g. text nodes)', () => {
    const textNode = document.createTextNode('hello');
    const entry = makeBase('layout-shift', {
      value: 0.02, hadRecentInput: false,
      sources: [{ node: textNode, currentRect: makeRect(), previousRect: makeRect() }],
    });
    // Text nodes are not Elements — describeNode returns nodeName = '#text'
    expect(serializeEntry(entry).sources![0]!.node).toBe('#text');
  });
});

describe('serializeEntry — INP / event timing', () => {
  it('serializes event timing fields for "event" type', () => {
    const entry = makeBase('event', {
      processingStart: 110, processingEnd: 130, interactionId: 42,
    });
    const result = serializeEntry(entry);
    expect(result.processingStart).toBe(110);
    expect(result.processingEnd).toBe(130);
    expect(result.interactionId).toBe(42);
  });

  it('serializes event timing fields for "first-input" type', () => {
    const entry = makeBase('first-input', {
      processingStart: 50, processingEnd: 60, interactionId: undefined,
    });
    const result = serializeEntry(entry);
    expect(result.processingStart).toBe(50);
    expect(result.interactionId).toBeUndefined();
  });
});

describe('describeNode — element descriptions', () => {
  it('includes only first class name when multiple classes present', () => {
    const el = document.createElement('section');
    el.id = 'content';
    el.className = 'container fluid';

    const entry = makeBase('largest-contentful-paint', {
      element: el, url: '', loadTime: 0, renderTime: 0,
    });
    expect(serializeEntry(entry).element).toBe('SECTION#content.container');
  });

  it('includes class but no id when id is empty', () => {
    const el = document.createElement('div');
    el.className = 'wrapper';
    const entry = makeBase('largest-contentful-paint', {
      element: el, url: '', loadTime: 0, renderTime: 0,
    });
    expect(serializeEntry(entry).element).toBe('DIV.wrapper');
  });
});
