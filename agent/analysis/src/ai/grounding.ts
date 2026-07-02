/**
 * Grounding validation for AI-generated suggestions.
 *
 * Two defenses against confident fabrication (observed in production: a model
 * invented a "639ms style recalculation" figure absent from its input and
 * claimed forced layouts affect TTFB):
 *
 * 1. Numeric grounding — every millisecond/CLS value the model cites must
 *    appear in the prompt data it was given. Unverifiable numbers halve the
 *    suggestion's confidence; if more than half of the cited values are
 *    unverifiable, the suggestion is dropped.
 *
 * 2. Causal lint — a narrow denylist of metric/cause pairings that are
 *    physically impossible (e.g. layout work cannot affect TTFB: the server
 *    responds before any rendering happens). Deliberately conservative:
 *    a suggestion is dropped only when a denied cause appears AND no
 *    plausible cause for that metric is mentioned.
 */
import type { Suggestion } from '@vitalsage/types';

export interface GroundingReport {
  kept:    Suggestion[];
  dropped: Array<{ title: string; reasons: string[] }>;
}

// ── Numeric grounding ─────────────────────────────────────────────────────────

/** All ms values and CLS-style decimals cited in a suggestion's text. */
function citedNumbers(text: string): string[] {
  const out: string[] = [];
  const msPattern = /(\d[\d,]*(?:\.\d+)?)\s*ms/gi;
  let m: RegExpExecArray | null;
  while ((m = msPattern.exec(text)) !== null) out.push(m[1]!.replace(/,/g, ''));
  const clsPattern = /\b(0\.\d{2,4})\b/g;
  while ((m = clsPattern.exec(text)) !== null) out.push(m[1]!);
  return out;
}

/** True when `value` (a normalized number string) appears in the prompt. */
function appearsInPrompt(value: string, normalizedPrompt: string): boolean {
  if (normalizedPrompt.includes(value)) return true;
  const num = parseFloat(value);
  if (!isFinite(num)) return false;
  // Accept ±1 rounding differences for integer ms values.
  if (Number.isInteger(num)) {
    return normalizedPrompt.includes(String(num + 1)) || normalizedPrompt.includes(String(num - 1));
  }
  // Accept the rounded form of a decimal.
  return normalizedPrompt.includes(String(Math.round(num)));
}

// ── Causal lint ───────────────────────────────────────────────────────────────

const CAUSAL_RULES: Partial<Record<string, { denied: RegExp; allowed: RegExp }>> = {
  // TTFB is finished before the browser renders anything — rendering-side
  // causes are impossible.
  TTFB: {
    denied:  /forced layout|layout thrash|style recalc|layout count|event listener|repaint|reflow|dom size|dom nodes/i,
    allowed: /server|redirect|dns|tls|ssl|cdn|cache|edge|worker|early hint|compression|response time|backend|origin|connection/i,
  },
  // CLS is a rendering phenomenon — network handshake causes are impossible.
  CLS: {
    denied:  /\bttfb\b|server response|dns lookup|tls handshake/i,
    allowed: /shift|image|font|dimension|banner|inject|animation|aspect|space|skeleton|embed|iframe|resize/i,
  },
};

function causalIssue(s: Suggestion): string | null {
  const rule = CAUSAL_RULES[s.metric];
  if (!rule) return null;
  const text = `${s.title} ${s.detail}`;
  if (rule.denied.test(text) && !rule.allowed.test(text)) {
    return `cites a cause that cannot affect ${s.metric}`;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function validateGrounding(
  suggestions: Suggestion[],
  promptText:  string,
): GroundingReport {
  // Normalize thousands separators so "4,300ms" in output matches "4300" in data.
  const normalizedPrompt = promptText.replace(/(\d),(\d)/g, '$1$2');

  const kept:    Suggestion[] = [];
  const dropped: Array<{ title: string; reasons: string[] }> = [];

  for (const s of suggestions) {
    const reasons: string[] = [];

    const causal = causalIssue(s);
    if (causal) reasons.push(causal);

    // estimatedImpact is deliberately excluded: impact projections
    // ("~200-400ms reduction") are derived estimates, not data citations.
    const cited      = citedNumbers(`${s.title} ${s.detail}`);
    const unverified = cited.filter(v => !appearsInPrompt(v, normalizedPrompt));
    if (cited.length > 0 && unverified.length > cited.length / 2) {
      reasons.push(`fabricated values: ${unverified.join('ms, ')}ms not present in input data`);
    }

    if (reasons.length > 0) {
      dropped.push({ title: s.title, reasons });
      continue;
    }

    // Partially unverifiable numbers → keep, but with halved confidence.
    kept.push(
      unverified.length > 0
        ? { ...s, confidence: Math.round(s.confidence * 0.5 * 100) / 100 }
        : s,
    );
  }

  return { kept, dropped };
}
