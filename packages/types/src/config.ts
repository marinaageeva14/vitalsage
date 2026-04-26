import type { StorageAdapter, BatchingConfig } from './storage.js';
import type { RouteConfig, NavigationMode } from './routing.js';
import type { ThresholdConfig } from './metrics.js';
import type { AgentName } from './suggestions.js';
import type { AIProvider } from './ai.js';

export interface AIConfig {
  provider:     'anthropic' | 'openai' | 'gemini' | AIProvider;
  apiKey:       string;
  model?:       string;
  maxTokens?:   number;
  temperature?: number;
}

export interface NavigationConfig {
  mode:             NavigationMode;
  resetOnNavigate?: boolean;
}

export interface ReporterConfig {
  console?: boolean;
}

export interface StorageConfig {
  adapter:   StorageAdapter;
  batching?: BatchingConfig;
}

export interface ClientConfig {
  storage:     StorageConfig;
  routes?:     RouteConfig[];
  navigation?: NavigationConfig;
  thresholds?: Partial<ThresholdConfig>;
  reporter?:   ReporterConfig;
  sampling?:   number;
  debug?:      boolean;
}

export interface EngineConfig {
  ai?:         AIConfig;
  agents?:     AgentName[] | 'all';
  thresholds?: Partial<ThresholdConfig>;
  debug?:      boolean;
}

export type NetworkProfile  = '4g' | '3g' | '2g' | 'slow-2g' | 'wifi';
export type ViewportProfile = 'desktop' | 'mobile' | 'tablet';

export interface SimulatorConfig {
  url:               string;
  routes?:           string[];
  runs:              number;
  networks?:         NetworkProfile[];
  viewports?:        ViewportProfile[];
  waitAfterLoad?:     number;
  interactAfterLoad?: boolean;
  captureTrace?:      boolean;
  /**
   * Capture the full CPU profiler trace (disabled-by-default-v8.cpu_profiler).
   * Produces per-function call stacks — the same data that powers the DevTools
   * flame chart. Significantly increases trace size (~50 MB per run) and
   * adds ~10–15 % CPU overhead during recording.
   * Only meaningful when captureTrace is also true.
   */
  captureFullTrace?:  boolean;
  outputDir:          string;
  concurrency?:       number;
  delayBetweenRuns?:  number;  // ms to wait between batch chunks
}
