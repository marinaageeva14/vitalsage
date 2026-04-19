import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../../src/ai/parser.js';

const AGENT  = 'lcp'  as const;
const METRIC = 'LCP'  as const;

function wrap(inner: string): string {
  return `<suggestions>${inner}</suggestions>`;
}

function suggestion(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  return `<suggestion>${body}</suggestion>`;
}

const VALID_FIELDS = {
  severity:   'critical',
  title:      'LCP image not preloaded',
  detail:     'The LCP image is not preloaded, adding 400ms delay.',
  effort:     'low',
  impact:     '~300ms LCP reduction',
  confidence: '0.85',
};

describe('parseAIResponse', () => {
  // --- Valid cases ---

  it('parses a single valid suggestion', () => {
    const xml = wrap(suggestion(VALID_FIELDS));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('LCP image not preloaded');
    expect(results[0]!.severity).toBe('critical');
    expect(results[0]!.effort).toBe('low');
    expect(results[0]!.confidence).toBe(0.85);
    expect(results[0]!.agent).toBe('lcp');
    expect(results[0]!.metric).toBe('LCP');
  });

  it('parses multiple suggestions', () => {
    const xml = wrap(
      suggestion(VALID_FIELDS) +
      suggestion({ ...VALID_FIELDS, title: 'Second suggestion', severity: 'warning' }),
    );
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(2);
    expect(results[1]!.severity).toBe('warning');
  });

  it('caps at 5 suggestions', () => {
    const xml = wrap(
      Array.from({ length: 8 }, (_, i) =>
        suggestion({ ...VALID_FIELDS, title: `Suggestion ${i}` })
      ).join(''),
    );
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(5);
  });

  it('generates stable suggestion ids', () => {
    const xml = wrap(suggestion(VALID_FIELDS));
    const r1 = parseAIResponse(xml, AGENT, METRIC);
    const r2 = parseAIResponse(xml, AGENT, METRIC);
    expect(r1[0]!.id).toBe(r2[0]!.id);
    expect(r1[0]!.id).toBeTruthy();
  });

  it('parses optional codeExample when all fields present', () => {
    const xml = wrap(suggestion({
      ...VALID_FIELDS,
      beforeCode:   '&lt;img src="/hero.jpg"&gt;',
      afterCode:    '&lt;img src="/hero.webp"&gt;',
      codeLanguage: 'html',
    }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.codeExample).toEqual({
      before:   '<img src="/hero.jpg">',
      after:    '<img src="/hero.webp">',
      language: 'html',
    });
  });

  it('omits codeExample when language is missing', () => {
    const xml = wrap(suggestion({
      ...VALID_FIELDS,
      beforeCode: 'fetchpriority=auto',
      afterCode:  'fetchpriority=high',
    }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.codeExample).toBeUndefined();
  });

  it('omits codeExample when beforeCode is missing', () => {
    const xml = wrap(suggestion({
      ...VALID_FIELDS,
      afterCode:    'fetchpriority=high',
      codeLanguage: 'html',
    }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.codeExample).toBeUndefined();
  });

  it('omits codeExample when afterCode is missing', () => {
    const xml = wrap(suggestion({
      ...VALID_FIELDS,
      beforeCode:   'fetchpriority=auto',
      codeLanguage: 'html',
    }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.codeExample).toBeUndefined();
  });

  it('accepts all valid code languages', () => {
    for (const lang of ['html', 'javascript', 'css', 'http', 'bash']) {
      const xml = wrap(suggestion({
        ...VALID_FIELDS,
        beforeCode:   'before',
        afterCode:    'after',
        codeLanguage: lang,
      }));
      const results = parseAIResponse(xml, AGENT, METRIC);
      expect(results[0]!.codeExample?.language).toBe(lang);
    }
  });

  it('rejects invalid code language — no codeExample', () => {
    const xml = wrap(suggestion({
      ...VALID_FIELDS,
      beforeCode:   'before',
      afterCode:    'after',
      codeLanguage: 'python',
    }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.codeExample).toBeUndefined();
  });

  it('parses affectedPercent', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, affectedPercent: '0.72' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.affectedPercent).toBeCloseTo(0.72);
  });

  it('omits affectedPercent when missing', () => {
    const xml = wrap(suggestion(VALID_FIELDS));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.affectedPercent).toBeUndefined();
  });

  it('parses learnMore url', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, learnMore: 'https://web.dev/lcp' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.learnMore).toBe('https://web.dev/lcp');
  });

  it('omits learnMore when missing', () => {
    const xml = wrap(suggestion(VALID_FIELDS));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.learnMore).toBeUndefined();
  });

  it('clamps confidence below 0 to 0', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, confidence: '-0.5' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.confidence).toBe(0);
  });

  it('clamps confidence above 1 to 1', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, confidence: '1.5' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.confidence).toBe(1);
  });

  it('defaults confidence to 0.7 when missing', () => {
    const { confidence: _, ...fieldsNoConf } = VALID_FIELDS;
    const xml = wrap(suggestion(fieldsNoConf));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.confidence).toBe(0.7);
  });

  it('defaults confidence to 0.7 when NaN', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, confidence: 'not-a-number' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.confidence).toBe(0.7);
  });

  it('accepts info severity', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, severity: 'info' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.severity).toBe('info');
  });

  it('accepts high effort', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, effort: 'high' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results[0]!.effort).toBe('high');
  });

  it('passes through agent and metric correctly', () => {
    const xml = wrap(suggestion(VALID_FIELDS));
    const results = parseAIResponse(xml, 'font', 'CLS');
    expect(results[0]!.agent).toBe('font');
    expect(results[0]!.metric).toBe('CLS');
  });

  // --- Invalid enum cases ---

  it('rejects suggestion with invalid severity', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, severity: 'urgent' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(0);
  });

  it('rejects suggestion with invalid effort', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, effort: 'trivial' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(0);
  });

  it('rejects suggestion with missing title', () => {
    const { title: _, ...noTitle } = VALID_FIELDS;
    const xml = wrap(suggestion(noTitle));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(0);
  });

  it('rejects suggestion with empty title', () => {
    const xml = wrap(suggestion({ ...VALID_FIELDS, title: '   ' }));
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(0);
  });

  it('filters invalid out of mixed list', () => {
    const xml = wrap(
      suggestion(VALID_FIELDS) +
      suggestion({ ...VALID_FIELDS, title: 'Good one', severity: 'invalid' as Severity }) +
      suggestion({ ...VALID_FIELDS, title: 'Another good one' }),
    );
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(2);
  });

  // --- Malformed / truncated XML ---

  it('returns [] for completely empty string', () => {
    expect(parseAIResponse('', AGENT, METRIC)).toEqual([]);
  });

  it('returns [] for plain text (no XML)', () => {
    expect(parseAIResponse('Sorry, I cannot help.', AGENT, METRIC)).toEqual([]);
  });

  it('returns [] for malformed XML', () => {
    expect(parseAIResponse('<suggestions><suggestion><title>oops</suggestions>', AGENT, METRIC)).toEqual([]);
  });

  it('returns [] when root tag is wrong', () => {
    const xml = `<results>${suggestion(VALID_FIELDS)}</results>`;
    expect(parseAIResponse(xml, AGENT, METRIC)).toEqual([]);
  });

  it('returns [] when no suggestion elements', () => {
    expect(parseAIResponse('<suggestions></suggestions>', AGENT, METRIC)).toEqual([]);
  });

  it('handles preamble text before XML gracefully', () => {
    // AI sometimes outputs text before the XML
    const xml = `Here are my suggestions:\n${wrap(suggestion(VALID_FIELDS))}`;
    // fast-xml-parser may or may not parse this — we only care it doesn't throw
    expect(() => parseAIResponse(xml, AGENT, METRIC)).not.toThrow();
  });

  it('handles XML with CDATA sections', () => {
    const xml = wrap(`<suggestion>
      <severity>warning</severity>
      <title><![CDATA[LCP image needs fetchpriority="high"]]></title>
      <detail>details</detail>
      <effort>low</effort>
      <impact>200ms</impact>
      <confidence>0.9</confidence>
    </suggestion>`);
    const results = parseAIResponse(xml, AGENT, METRIC);
    // Either parsed or empty — must not throw
    expect(Array.isArray(results)).toBe(true);
  });

  it('trims whitespace from field values', () => {
    const xml = wrap(`<suggestion>
      <severity>  critical  </severity>
      <title>  LCP image not preloaded  </title>
      <detail>  Details here.  </detail>
      <effort>  low  </effort>
      <impact>  ~300ms  </impact>
      <confidence>  0.85  </confidence>
    </suggestion>`);
    const results = parseAIResponse(xml, AGENT, METRIC);
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe('critical');
    expect(results[0]!.title).toBe('LCP image not preloaded');
  });
});
