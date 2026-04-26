import type { DeviceContext, PageContext } from './context.js';
import type { MetricName, MetricRating } from './metrics.js';

export type InteractionType   = 'INITIAL_LOAD' | 'NAVIGATION';
export type InteractionStatus = 'success' | 'cancel' | 'timeout' | 'fail';

export interface MetricSnapshot {
  value:  number;
  rating: MetricRating;
}

/**
 * A complete, self-contained record of a single user interaction with a page.
 *
 * INITIAL_LOAD — from navigationStart until the page is backgrounded / next navigation.
 * NAVIGATION   — from the moment the route changes until the user leaves or the next navigation.
 *
 * status:
 *   success — interaction completed normally
 *   cancel  — a new interaction started before this one could complete (e.g. rapid navigation)
 *   timeout — no completion signal within 60 s
 *   fail    — a [data-interaction-error] element was detected in the DOM during the interaction
 */
export interface Interaction {
  id:        string;
  type:      InteractionType;
  status:    InteractionStatus;
  uri:       string;           // current URL when interaction started
  referrer:  string | null;    // document.referrer (INITIAL_LOAD) or previous URI (NAVIGATION)
  metrics:   Partial<Record<MetricName, MetricSnapshot>>;
  device:    DeviceContext;
  timestamp: number;           // Unix ms when interaction started
  duration:  number;           // ms from start to completion
  /**
   * Page context captured at interaction completion time — resources, scripts,
   * images, fonts, LCP element descriptor, and navigation timing.
   *
   * Present on success / fail / timeout interactions. Absent on `cancel`
   * (rapid navigation away before the page settled — DOM is already in transition).
   *
   * This is the same shape as PageContext in SessionReport, so the analysis
   * engine receives equally rich data from real users and synthetic simulation.
   */
  page?:     PageContext;
}
