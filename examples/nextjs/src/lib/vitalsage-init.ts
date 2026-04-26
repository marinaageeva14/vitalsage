/**
 * VitalSage initialisation for the Next.js example.
 * Called from VitalSageProvider (client component) — never runs on the server.
 */

const SERVER = 'http://localhost:3001';
const APP    = 'nextjs';

let initialised = false;

// ── Boot ──────────────────────────────────────────────────────────────
export async function bootVitalSage(): Promise<void> {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  const { init, createLoggingAdapter, composeAdapters } =
    await import('../../../../packages/client/dist/vitalsage.js');

  // ── Debug panel ────────────────────────────────────────────────────
  function createPanel(): HTMLElement {
    const existing = document.getElementById('ps-panel');
    if (existing) return existing;
    const el = Object.assign(document.createElement('div'), { id: 'ps-panel' });
    Object.assign(el.style, {
      position: 'fixed', bottom: '12px', right: '12px', zIndex: '9999',
      background: '#0f1117', color: '#e2e8f0', fontFamily: 'monospace',
      fontSize: '11px', padding: '10px 14px', borderRadius: '8px',
      border: '1px solid #2d3748', minWidth: '220px', lineHeight: '1.8',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    });
    document.body.appendChild(el);
    return el;
  }

  const STATUS_ICON: Record<string, string> = { success: '✅', cancel: '⚡', timeout: '⏱', fail: '❌' };
  const RATING_ICON: Record<string, string> = { good: '🟢', 'needs-improvement': '🟡', poor: '🔴' };

  function renderPanel(interaction: Record<string, unknown>): void {
    const el      = document.getElementById('ps-panel') ?? createPanel();
    const metrics = (interaction.metrics ?? {}) as Record<string, { value: number; rating: string }>;
    const fmt     = (v: number, name: string) => name === 'CLS' ? v.toFixed(3) : `${Math.round(v)}ms`;
    const rate    = (r: string) => RATING_ICON[r] ?? '⚪';
    const rows    = ['LCP', 'FCP', 'TTFB', 'CLS', 'INP'].map(name => {
      const m = metrics[name];
      return m
        ? `${rate(m.rating)} <b>${name}</b> ${fmt(m.value, name)}`
        : `⚪ <b>${name}</b> –`;
    });
    const icon = STATUS_ICON[interaction.status as string] ?? '?';
    const uri  = interaction.uri as string ?? '';
    const path = (() => { try { return new URL(uri).pathname; } catch { return uri; } })();

    el.innerHTML =
      `<b style="color:#6366f1">VitalSage</b> ` +
      `<span style="color:#64748b">${APP} · ${path}</span> ${icon}<br>` +
      `<span style="color:#64748b;font-size:10px">${interaction.type} · ${interaction.duration}ms</span><br>` +
      rows.join('<br>');
  }

  createPanel();

  const serverAdapter = {
    onInteraction: async (interaction: Record<string, unknown>) => {
      fetch(`${SERVER}/api/interaction`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ app: APP, ...interaction }),
      }).catch(() => {});
    },
  };

  const panelAdapter = {
    onInteraction: (interaction: Record<string, unknown>) => renderPanel(interaction),
  };

  const instance = init({
    storage: {
      adapter: composeAdapters(
        createLoggingAdapter({ label: APP }),
        panelAdapter,
        serverAdapter,
      ),
    },
  });

  (window as unknown as Record<string, unknown>).__ps_instance = instance;
}
