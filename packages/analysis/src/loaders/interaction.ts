/**
 * Converts a client-SDK `Interaction` (captured by real users in the browser)
 * into the `SessionReport` shape that `AnalysisEngine.analyze()` expects.
 *
 * This bridges the gap between real-user monitoring (RUM) data stored by the
 * example server and the analysis engine, which was originally designed to
 * consume synthetic Playwright simulator sessions.
 */

import type { Interaction, MetricName, MetricSnapshot } from '@vitalsage/types';
import type { SessionReport }   from '@vitalsage/types';
import type { RawMetricValue }  from '@vitalsage/types';
import type { PageContext }     from '@vitalsage/types';
import type { RouteContext }    from '@vitalsage/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePath(uri: string): string {
  try { return new URL(uri).pathname; } catch { return uri; }
}

/**
 * Minimal `PageContext` used when the real-user interaction pre-dates
 * ContextCollector wiring, or was a `cancel` that skipped context collection.
 */
function stubPageContext(uri: string, referrer: string | null): PageContext {
  return {
    url:          uri,
    referrer:     referrer ?? '',
    title:        '',
    domNodeCount: 0,
    resources:    [],
    fonts:        [],
    images:       [],
    scripts:      [],
    stylesheets:  [],
    navigationTiming: {
      redirectTime:    0,
      dnsTime:         0,
      tlsTime:         0,
      serverTime:      0,
      downloadTime:    0,
      domParseTime:    0,
      totalLoadTime:   0,
      workerTime:      0,
      isServiceWorker: false,
      redirectCount:   0,
    },
  };
}

/**
 * Lift a `MetricSnapshot` (value + rating only) into the fuller `RawMetricValue`
 * shape that `CoreWebVitals` uses.  Fields not available from RUM data
 * (`delta`, `navigationType`, `entries`) are filled with neutral defaults.
 */
function snapshotToRaw(name: MetricName, snap: MetricSnapshot): RawMetricValue {
  return {
    name,
    value:          snap.value,
    rating:         snap.rating,
    delta:          snap.value,   // first-and-only report; delta == value
    id:             `${name}-rum`,
    navigationType: 'navigate',
    entries:        [],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Converts a single `Interaction` to a `SessionReport`.
 *
 * Returns `null` for `cancel` interactions — they were interrupted before the
 * page settled so their CWV values are incomplete and would skew distributions.
 */
export function interactionToSession(interaction: Interaction): SessionReport | null {
  if (interaction.status === 'cancel') return null;

  const path = parsePath(interaction.uri);

  const route: RouteContext = {
    pattern:         path,
    path,
    visitId:         interaction.id,
    navigationIndex: interaction.type === 'INITIAL_LOAD' ? 0 : 1,
  };

  // Build CoreWebVitals from the stored MetricSnapshot values.
  const metrics: SessionReport['metrics'] = {};
  for (const [key, snap] of Object.entries(interaction.metrics)) {
    if (snap) {
      metrics[key as MetricName] = snapshotToRaw(key as MetricName, snap);
    }
  }

  const page: PageContext = interaction.page ?? stubPageContext(interaction.uri, interaction.referrer);

  return {
    sessionId:  interaction.id,
    visitId:    interaction.id,
    route,
    url:        interaction.uri,
    timestamp:  interaction.timestamp,
    device:     interaction.device,
    page,
    metrics,
    synthetic:  false,
    sdkVersion: '0.1.0',
  };
}

/**
 * Converts an array of `Interaction` objects, filtering out nulls (cancels).
 */
export function interactionsToSessions(interactions: Interaction[]): SessionReport[] {
  return interactions.flatMap(i => {
    const s = interactionToSession(i);
    return s ? [s] : [];
  });
}
