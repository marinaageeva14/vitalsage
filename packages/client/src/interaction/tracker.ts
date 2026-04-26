import type {
  DeviceContext,
  Interaction,
  InteractionStatus,
  MetricName,
  MetricSnapshot,
  MetricRating,
  RawMetricValue,
  StorageAdapter,
} from '@vitalsage/types';
import { generateId } from '../utils/id.js';

// Inlined to avoid a runtime import from the types-only @vitalsage/types package.
const THRESHOLDS: Record<MetricName, { good: number; poor: number }> = {
  LCP:  { good: 2500, poor: 4000  },
  FCP:  { good: 1800, poor: 3000  },
  CLS:  { good: 0.1,  poor: 0.25  },
  INP:  { good: 200,  poor: 500   },
  TTFB: { good: 800,  poor: 1800  },
};

// How long DOM must be mutation-free (after LCP has fired) before we call the interaction done.
const SETTLE_MS  = 200;
const TIMEOUT_MS = 60_000;

// ── Types ────────────────────────────────────────────────────────────

interface ActiveInteraction {
  id:             string;
  type:           'INITIAL_LOAD' | 'NAVIGATION';
  uri:            string;
  referrer:       string | null;
  startPerfTime:  number;
  timestamp:      number;
  metrics:        Partial<Record<MetricName, MetricSnapshot>>;
  status:         InteractionStatus;
  /** Hard 60 s timeout handle. */
  timeoutHandle:  ReturnType<typeof setTimeout> | null;
  /** Settle poll timer handle. */
  settleHandle:   ReturnType<typeof setTimeout> | null;
  /** True once an LCP entry belonging to this interaction has been recorded. */
  hasLCP:         boolean;
  clsBaseline:    number;
  inpBaseline:    number;
  /**
   * performance.now() of the last qualifying DOM mutation for this interaction.
   * Initialised to startPerfTime so the first settle poll always waits SETTLE_MS.
   */
  lastMutationAt: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function rateMetric(name: MetricName, value: number): MetricRating {
  const t = THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function safeCall(fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(e => console.warn('[VitalSage] adapter error:', e));
  } catch (e) {
    console.warn('[VitalSage] adapter error:', e);
  }
}

// ── InteractionTracker ───────────────────────────────────────────────

export class InteractionTracker {
  private current:        ActiveInteraction | null = null;
  private errorObserver:  MutationObserver  | null = null;
  private settleObserver: MutationObserver  | null = null;

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly device:  DeviceContext,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────

  start(): void {
    this.setupObservers();
    this.setupPageHideListeners();
    this.startInteraction('INITIAL_LOAD', location.href, document.referrer || null, 0, 0, 0);
  }

  onNavigation(newUri: string, prevSnapshot: Partial<Record<MetricName, RawMetricValue>>): void {
    const prevUri     = this.current?.uri ?? null;
    const clsBaseline = prevSnapshot.CLS?.value ?? 0;
    const inpBaseline = prevSnapshot.INP?.value ?? 0;

    this.completeInteraction('cancel');
    // NAVIGATION startPerfTime = now() so duration is measured from the route change.
    this.startInteraction('NAVIGATION', newUri, prevUri, clsBaseline, inpBaseline, performance.now());

    // LCP never re-fires after a user interaction (the nav click finalises the LCP
    // observer). For NAVIGATION we rely on DOM-quiet alone, so seed the settle poll
    // immediately — it will fire after SETTLE_MS of DOM quiet.
    if (this.current) this.scheduleSettle(this.current);
  }

  onMetric(metric: RawMetricValue): void {
    if (!this.current) return;
    const { name, value, rating, delta } = metric;
    const c = this.current;

    switch (name) {
      case 'LCP':
        // Only accept LCP entries painted after this interaction started.
        if (value <= c.startPerfTime) return;
        c.metrics.LCP = { value, rating };
        c.hasLCP = true;
        // LCP fired — kick off the settle check immediately. If the DOM is already
        // quiet the timer will fire in 200 ms; any subsequent mutation resets it.
        this.scheduleSettle(c);
        break;

      case 'FCP':
        c.metrics.FCP = { value, rating };
        break;

      case 'TTFB':
        c.metrics.TTFB = { value, rating };
        break;

      case 'CLS': {
        const clsDelta = Math.max(0, value - c.clsBaseline);
        c.metrics.CLS = { value: clsDelta, rating: rateMetric('CLS', clsDelta) };
        break;
      }

      case 'INP': {
        if (c.type === 'NAVIGATION' && value <= c.inpBaseline) return;
        const inpValue = c.type === 'NAVIGATION' ? Math.max(0, delta) : value;
        if (inpValue <= 0) return;
        c.metrics.INP = { value: inpValue, rating: rateMetric('INP', inpValue) };
        break;
      }
    }
  }

  stop(): void {
    if (this.current) this.completeInteraction('cancel');
    this.errorObserver?.disconnect();
    this.settleObserver?.disconnect();
    this.errorObserver  = null;
    this.settleObserver = null;
  }

  // ── Private ────────────────────────────────────────────────────────

  private startInteraction(
    type:          'INITIAL_LOAD' | 'NAVIGATION',
    uri:           string,
    referrer:      string | null,
    clsBaseline:   number,
    inpBaseline:   number,
    startPerfTime: number,
  ): void {
    this.current = {
      id:             generateId(),
      type,
      uri,
      referrer,
      startPerfTime,
      timestamp:      Date.now(),
      metrics:        {},
      status:         'success',
      timeoutHandle:  setTimeout(() => this.completeInteraction('timeout'), TIMEOUT_MS),
      settleHandle:   null,
      hasLCP:         false,
      clsBaseline,
      inpBaseline,
      lastMutationAt: startPerfTime,
    };
  }

  /**
   * Arm (or re-arm) the DOM-quiet settle poll.
   *
   * Crucially, the MutationObserver does NOT call this — it only updates
   * `c.lastMutationAt`.  This method is only called from two places:
   *   1. `onNavigation` / LCP fires — to seed the poll for a new interaction.
   *   2. The poll callback itself — to self-reschedule if the DOM is still hot.
   *
   * This means the timer is never endlessly reset by a burst of mutations;
   * instead it fires on its own schedule and checks whether enough quiet time
   * has accumulated since the last mutation.
   */
  private scheduleSettle(c: ActiveInteraction): void {
    if (c.settleHandle !== null) clearTimeout(c.settleHandle);

    // Fire at (lastMutationAt + SETTLE_MS), or at least SETTLE_MS from now.
    const delay = Math.max(SETTLE_MS, c.lastMutationAt + SETTLE_MS - performance.now());

    c.settleHandle = setTimeout(() => {
      c.settleHandle = null;
      if (c !== this.current) return;

      const quietMs = performance.now() - c.lastMutationAt;
      if (quietMs < SETTLE_MS) {
        // A mutation landed after we scheduled — wait for the remainder.
        this.scheduleSettle(c);
        return;
      }

      // INITIAL_LOAD: wait for LCP before completing — ensures we don't fire
      // before the largest element has painted.
      // NAVIGATION: LCP never re-fires (browser finalises the LCP observer on the
      // click that caused the navigation), so DOM-quiet alone is sufficient.
      if (c.type === 'INITIAL_LOAD' && !c.hasLCP) return;

      // Block if any element is still explicitly marked as loading.
      // Re-arm the poll — don't bail permanently; loading will finish eventually.
      if (document.querySelector('[data-loading]')) {
        this.scheduleSettle(c);
        return;
      }

      this.completeInteraction('success');
    }, delay);
  }

  private completeInteraction(triggerStatus: InteractionStatus): void {
    const c = this.current;
    if (!c) return;

    this.current = null;
    clearTimeout(c.timeoutHandle ?? undefined);
    clearTimeout(c.settleHandle  ?? undefined);

    const status: InteractionStatus = c.status === 'fail' ? 'fail' : triggerStatus;

    const interaction: Interaction = {
      id:        c.id,
      type:      c.type,
      status,
      uri:       c.uri,
      referrer:  c.referrer,
      metrics:   c.metrics,
      device:    this.device,
      timestamp: c.timestamp,
      duration:  Math.round(performance.now() - c.startPerfTime),
    };

    safeCall(() => this.adapter.onInteraction?.(interaction));
  }

  private setupObservers(): void {
    if (typeof MutationObserver === 'undefined') return;

    // ── Settle observer — watches qualifying DOM mutations ───────────
    // Only records the time of the last mutation.  The settle poll timer
    // (armed by scheduleSettle) checks this timestamp when it fires and
    // self-reschedules if the DOM is still too recent.  We deliberately do
    // NOT reset the timer here — that prevented it from ever firing in
    // mutation-heavy React apps.
    this.settleObserver = new MutationObserver(() => {
      if (this.current) this.current.lastMutationAt = performance.now();
    });

    // ── Error observer — watches for [data-interaction-error] ────────
    this.errorObserver = new MutationObserver(() => {
      if (this.current && document.querySelector('[data-interaction-error]')) {
        this.current.status = 'fail';
      }
    });

    const attach = () => {
      if (!document.body) return;
      // Settle observer — structural changes + data-loading attribute only.
      // Intentionally excludes generic attribute changes (class, style, aria-*)
      // so React/Vue re-renders don't prevent the 200 ms quiet window from closing.
      this.settleObserver!.observe(document.body, {
        childList:       true,
        subtree:         true,
        attributes:      true,
        attributeFilter: ['data-loading'],
      });
      this.errorObserver!.observe(document.body, {
        childList:       true,
        subtree:         true,
        attributes:      true,
        attributeFilter: ['data-interaction-error'],
      });
    };

    if (document.body) {
      attach();
    } else {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    }
  }

  private setupPageHideListeners(): void {
    window.addEventListener('pagehide', () => {
      this.completeInteraction('success');
    }, { capture: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.completeInteraction('success');
    });
  }
}
