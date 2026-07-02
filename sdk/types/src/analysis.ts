import type { MetricName, MetricDistribution, ThresholdConfig } from './metrics.js';
import type { RouteContext, RouteConfig } from './routing.js';
import type { PageContext } from './context.js';
import type { SessionReport } from './session.js';
import type { Suggestion, AgentName } from './suggestions.js';

export type AnalysisConfidence =
  | 'insufficient'
  | 'low'
  | 'medium'
  | 'high';

export const CONFIDENCE_THRESHOLDS = {
  low:    100,
  medium: 500,
  high:   2000,
} as const;

export interface AnalysisOptions {
  timeWindow?:           { from: number; to: number };
  routes?:               string[];
  minSamples?:           number;
  includeRealOnly?:      boolean;
  includeSyntheticOnly?: boolean;
}

/**
 * Per-route telemetry for the AI enhancement pass. Makes AI failures visible:
 * without this, a timed-out or unparseable AI call is indistinguishable from
 * "the AI found nothing".
 */
export interface AIEnhancementTelemetry {
  provider:   string;
  calls:      number;
  succeeded:  number;
  failed:     number;
  timedOut:   number;
  tokensUsed: number;
  durationMs: number;
  /** Deduplicated error messages (capped). */
  errors?:    string[];
}

export interface AnalysisReport {
  analysisId:      string;
  generatedAt:     number;
  route:           RouteContext;
  sampleSize:      number;
  syntheticCount:  number;
  realCount:       number;
  timeWindow:      { from: number; to: number };
  confidence:      AnalysisConfidence;
  distributions:   Partial<Record<MetricName, MetricDistribution>>;
  suggestions:     Suggestion[];
  analysisVersion: string;
  screenshot?:     string;
  traceMetrics?:   import('./trace.js').TraceMetrics;
  /** Present when AI enhancement was configured for this analysis. */
  ai?:             AIEnhancementTelemetry;
}

export interface AgentContext {
  distributions:       Partial<Record<MetricName, MetricDistribution>>;
  representativePage:  PageContext;
  sessions:            SessionReport[];
  sampleSize:          number;
  confidence:          AnalysisConfidence;
  thresholds:          ThresholdConfig;
  routeConfig?:        RouteConfig;
}

export type { AgentName };
