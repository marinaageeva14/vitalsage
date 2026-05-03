import type { StorageAdapter, Interaction, MetricName } from '@vitalsage/types';

export interface LoggingAdapterOptions {
  /**
   * Turn logging on/off without removing the adapter from the chain.
   * @default true
   */
  enabled?: boolean;

  /**
   * Also log the full raw interaction object so you can inspect every field.
   * @default false
   */
  verbose?: boolean;

  /**
   * Label shown in the group header — useful when multiple apps share a console.
   * e.g. 'vanilla', 'react', 'nextjs'
   */
  label?: string;
}

const METRIC_NAMES: MetricName[] = ['LCP', 'FCP', 'TTFB', 'CLS', 'INP'];

const RATING_ICON: Record<string, string> = {
  'good':               '🟢',
  'needs-improvement':  '🟡',
  'poor':               '🔴',
};

const STATUS_ICON: Record<string, string> = {
  success: '✅',
  cancel:  '⚡',
  timeout: '⏱',
  fail:    '❌',
};

function fmtValue(name: MetricName, value: number): string {
  return name === 'CLS' ? value.toFixed(3) : `${Math.round(value)}ms`;
}

/**
 * Creates a StorageAdapter that logs completed interaction objects to the console.
 *
 * One grouped log entry per interaction (INITIAL_LOAD or NAVIGATION),
 * with a table of all collected CWV metrics.
 *
 * @example
 * init({
 *   storage: {
 *     adapter: composeAdapters(
 *       createLoggingAdapter({ label: 'my-app' }),
 *       myServerAdapter,
 *     ),
 *   },
 * });
 */
export function createLoggingAdapter(options: LoggingAdapterOptions = {}): StorageAdapter {
  const { enabled = true, verbose = false, label } = options;

  if (!enabled) return {};

  const NS    = label ? `VitalSage · ${label}` : 'VitalSage';
  const STYLE = 'color:#6366f1;font-weight:bold';

  return {
    onInteraction(interaction: Interaction): void {
      const { type, status, uri, referrer, duration, metrics, device, timestamp } = interaction;
      const statusIcon = STATUS_ICON[status] ?? '?';
      const path = (() => { try { return new URL(uri).pathname; } catch { return uri; } })();

      console.group(
        `%c[${NS}]  ${type}  ${statusIcon} ${status}  ${path}  (${duration}ms)`,
        STYLE,
      );

      // ── Metrics table ─────────────────────────────────────────────
      const available = METRIC_NAMES.filter(n => metrics[n] != null);
      if (available.length) {
        console.table(
          Object.fromEntries(
            available.map(n => {
              const m = metrics[n]!;
              return [
                n,
                {
                  value:  fmtValue(n, m.value),
                  rating: `${RATING_ICON[m.rating] ?? '⚪'} ${m.rating}`,
                },
              ];
            })
          )
        );
      } else {
        console.log('(no metrics collected)');
      }

      // ── Context ───────────────────────────────────────────────────
      console.log('uri      :', uri);
      if (referrer) console.log('referrer :', referrer);
      console.log('device   :', `${device.deviceCategory} · ${device.connection?.type ?? 'unknown'}`);
      console.log('duration :', `${duration}ms`);
      console.log('time     :', new Date(timestamp).toISOString());

      // ── Page context summary ───────────────────────────────────────
      if (interaction.page) {
        const p = interaction.page;
        const blocking = p.scripts.filter(s => s.isRenderBlocking).length;
        console.log(
          'page     :',
          `${p.domNodeCount} nodes · ${p.resources.length} resources · ` +
          `${p.scripts.length} scripts (${blocking} render-blocking) · ` +
          `${p.images.length} images · ${p.fonts.length} fonts`,
        );
        if (p.lcpElement) {
          const el = p.lcpElement;
          const hints: string[] = [];
          if (el.elementType === 'img' && !el.fetchPriority) hints.push('no fetchpriority');
          if (!el.isPreloaded) hints.push('not preloaded');
          if (el.isThirdParty)  hints.push('third-party');
          console.log(
            'lcp el   :',
            `<${el.tagName.toLowerCase()}>${el.src ? ' ' + el.src.replace(/^https?:\/\/[^/]+/, '') : ''}` +
            (hints.length ? `  ⚠ ${hints.join(', ')}` : '  ✓'),
          );
        }
      }

      if (verbose) {
        console.log('--- raw ---');
        console.log(interaction);
      }

      console.groupEnd();
    },
  };
}
