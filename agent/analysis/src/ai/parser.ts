import { XMLParser } from 'fast-xml-parser';
import type { AgentName, MetricName, Suggestion, Severity, Effort } from '@vitalsage/types';
import { generateSuggestionId } from '../utils/id.js';

const VALID_SEVERITIES = new Set<Severity>(['critical', 'warning', 'info']);
const VALID_EFFORTS    = new Set<Effort>(['low', 'medium', 'high']);
const VALID_LANGS      = new Set<string>(['html', 'javascript', 'css', 'http', 'bash']);
const VALID_METRICS    = new Set<MetricName>(['LCP', 'FCP', 'CLS', 'INP', 'TTFB']);

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

type RawSuggestion = Record<string, unknown>;

/**
 * Isolate the <suggestions> document from whatever surrounds it. Models
 * routinely wrap output in markdown fences or add prose despite
 * instructions; parsing the raw response then fails and every suggestion
 * is silently lost.
 */
function extractSuggestionsXml(raw: string): string | null {
  const unfenced = raw.replace(/```(?:xml)?/g, '');
  if (/<suggestions\s*\/>/.test(unfenced)) return '<suggestions/>';
  const start = unfenced.indexOf('<suggestions');
  const end   = unfenced.lastIndexOf('</suggestions>');
  if (start === -1 || end === -1 || end < start) return null;
  return unfenced.slice(start, end + '</suggestions>'.length);
}

export function parseAIResponse(
  xml:    string,
  agent:  AgentName,
  metric: MetricName,
): Suggestion[] {
  const snippet = extractSuggestionsXml(xml);
  if (!snippet) return [];

  let root: Record<string, unknown>;
  try {
    root = parser.parse(snippet) as Record<string, unknown>;
  } catch {
    return [];
  }

  const suggestionsEl = root['suggestions'] as Record<string, unknown> | undefined;
  if (!suggestionsEl) return [];

  const raw = suggestionsEl['suggestion'];
  if (!raw) return [];

  // fast-xml-parser returns an array when multiple, object when single
  const items: RawSuggestion[] = Array.isArray(raw) ? raw as RawSuggestion[] : [raw as RawSuggestion];

  return items
    .map((el): Suggestion | null => {
      const title    = str(el, 'title');
      const severity = str(el, 'severity') as Severity;
      const effort   = str(el, 'effort') as Effort;
      const lang     = str(el, 'codeLanguage');

      if (!title)                          return null;
      if (!VALID_SEVERITIES.has(severity)) return null;
      if (!VALID_EFFORTS.has(effort))      return null;

      const rawConf    = parseFloat(str(el, 'confidence') ?? '0.7');
      const rawAffStr  = str(el, 'affectedPercent');
      const rawAff     = rawAffStr !== undefined ? parseFloat(rawAffStr) : NaN;
      const before     = str(el, 'beforeCode');
      const after      = str(el, 'afterCode');

      const confidence      = isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : 0.7;
      const affectedPercent = isFinite(rawAff)  ? rawAff : undefined;

      const codeExample =
        before && after && lang && VALID_LANGS.has(lang)
          ? { before, after, language: lang as 'html' | 'javascript' | 'css' | 'http' | 'bash' }
          : undefined;

      const learnMore = str(el, 'learnMore');

      return {
        id:              generateSuggestionId(agent, metric, title),
        agent,
        metric,
        severity,
        title,
        detail:          str(el, 'detail') ?? '',
        effort,
        estimatedImpact: str(el, 'impact') ?? '',
        confidence,
        ...(affectedPercent !== undefined ? { affectedPercent } : {}),
        ...(codeExample ? { codeExample } : {}),
        ...(learnMore   ? { learnMore }   : {}),
      };
    })
    .filter((s): s is Suggestion => s !== null)
    .slice(0, 5);
}

/**
 * Parse AI suggestions where each suggestion includes its own `<metric>` field.
 * Used by agents (e.g. TraceAgent) that can produce suggestions for multiple metrics.
 * Falls back to `defaultMetric` when the metric field is absent or invalid.
 */
export function parseAISuggestions(
  xml:           string,
  agent:         AgentName,
  defaultMetric: MetricName = 'LCP',
): Suggestion[] {
  const snippet = extractSuggestionsXml(xml);
  if (!snippet) return [];

  let root: Record<string, unknown>;
  try {
    root = parser.parse(snippet) as Record<string, unknown>;
  } catch {
    return [];
  }

  const suggestionsEl = root['suggestions'] as Record<string, unknown> | undefined;
  if (!suggestionsEl) return [];

  const raw = suggestionsEl['suggestion'];
  if (!raw) return [];

  const items: RawSuggestion[] = Array.isArray(raw) ? raw as RawSuggestion[] : [raw as RawSuggestion];

  return items
    .map((el): Suggestion | null => {
      const title    = str(el, 'title');
      const severity = str(el, 'severity') as Severity;
      const effort   = str(el, 'effort') as Effort;
      const lang     = str(el, 'codeLanguage');

      if (!title)                          return null;
      if (!VALID_SEVERITIES.has(severity)) return null;
      if (!VALID_EFFORTS.has(effort))      return null;

      const rawMetric  = str(el, 'metric') as MetricName | undefined;
      const metric: MetricName = rawMetric && VALID_METRICS.has(rawMetric) ? rawMetric : defaultMetric;

      const rawConf    = parseFloat(str(el, 'confidence') ?? '0.7');
      const rawAffStr  = str(el, 'affectedPercent');
      const rawAff     = rawAffStr !== undefined ? parseFloat(rawAffStr) : NaN;
      const before     = str(el, 'beforeCode');
      const after      = str(el, 'afterCode');

      const confidence      = isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : 0.7;
      const affectedPercent = isFinite(rawAff)  ? rawAff : undefined;

      const codeExample =
        before && after && lang && VALID_LANGS.has(lang)
          ? { before, after, language: lang as 'html' | 'javascript' | 'css' | 'http' | 'bash' }
          : undefined;

      const learnMore = str(el, 'learnMore');

      return {
        id:              generateSuggestionId(agent, metric, title),
        agent,
        metric,
        severity,
        title,
        detail:          str(el, 'detail') ?? '',
        effort,
        estimatedImpact: str(el, 'impact') ?? '',
        confidence,
        ...(affectedPercent !== undefined ? { affectedPercent } : {}),
        ...(codeExample ? { codeExample } : {}),
        ...(learnMore   ? { learnMore }   : {}),
      };
    })
    .filter((s): s is Suggestion => s !== null)
    .slice(0, 6);
}

function str(el: RawSuggestion, key: string): string | undefined {
  const v = el[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}
