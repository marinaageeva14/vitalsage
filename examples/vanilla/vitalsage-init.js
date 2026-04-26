// Shared VitalSage initialisation used by every vanilla HTML page.
// Import as: <script type="module" src="./vitalsage-init.js">

import { init, createLoggingAdapter, composeAdapters } from '../../packages/client/dist/vitalsage.js';

const SERVER = 'http://localhost:3001';
const APP    = 'vanilla';

// ── Debug panel ─────────────────────────────────────────────────────
function createPanel() {
  const el = Object.assign(document.createElement('div'), { id: 'ps-panel' });
  Object.assign(el.style, {
    position: 'fixed', bottom: '12px', right: '12px', zIndex: 9999,
    background: '#0f1117', color: '#e2e8f0', fontFamily: 'monospace',
    fontSize: '11px', padding: '10px 14px', borderRadius: '8px',
    border: '1px solid #2d3748', minWidth: '220px', lineHeight: '1.8',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  });
  document.body.appendChild(el);
  return el;
}

function getPanel() {
  return document.getElementById('ps-panel') ?? createPanel();
}

const STATUS_ICON = { success: '✅', cancel: '⚡', timeout: '⏱', fail: '❌' };
const RATING_ICON = { good: '🟢', 'needs-improvement': '🟡', poor: '🔴' };

function renderPanel(interaction) {
  const el   = getPanel();
  const fmt  = (v, name) => name === 'CLS' ? v.toFixed(3) : `${Math.round(v)}ms`;
  const rate = (r) => RATING_ICON[r] ?? '⚪';
  const rows = ['LCP', 'FCP', 'TTFB', 'CLS', 'INP'].map(name => {
    const m = interaction.metrics[name];
    return m
      ? `${rate(m.rating)} <b>${name}</b> ${fmt(m.value, name)}`
      : `⚪ <b>${name}</b> –`;
  });

  const icon   = STATUS_ICON[interaction.status] ?? '?';
  const path   = (() => { try { return new URL(interaction.uri).pathname; } catch { return interaction.uri; } })();

  el.innerHTML =
    `<b style="color:#6366f1">VitalSage</b> ` +
    `<span style="color:#64748b">${APP} · ${path}</span> ${icon}<br>` +
    `<span style="color:#64748b;font-size:10px">${interaction.type} · ${interaction.duration}ms</span><br>` +
    rows.join('<br>');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => getPanel());
} else {
  getPanel();
}

// ── Server adapter ───────────────────────────────────────────────────
const serverAdapter = {
  onInteraction: async (interaction) => {
    fetch(`${SERVER}/api/interaction`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ app: APP, ...interaction }),
    }).catch(() => {});
  },
};

// ── Panel adapter ────────────────────────────────────────────────────
const panelAdapter = {
  onInteraction: (interaction) => renderPanel(interaction),
};

// ── SDK init ─────────────────────────────────────────────────────────
export const instance = init({
  storage: {
    adapter: composeAdapters(
      createLoggingAdapter({ label: APP }),
      panelAdapter,
      serverAdapter,
    ),
  },
});

window.__ps_instance = instance;
