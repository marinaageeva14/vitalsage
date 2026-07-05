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
  /** Per-request timeout for provider calls. Default: 60 000 ms. */
  timeoutMs?:   number;
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

  /**
   * Drive a system-installed browser by channel (e.g. 'chrome', 'msedge')
   * instead of Playwright's bundled Chromium. Lets VitalSage run on machines
   * whose OS is too old for the bundled browser, as long as Chrome/Edge is
   * installed. CDP tracing is unaffected — every Chromium build speaks it.
   */
  browserChannel?: string;
  /**
   * Persistent user-data directory. When set, the simulator reuses one browser
   * profile across runs so cookies and logins persist — this is what lets you
   * trace pages behind authentication (log in once, trace the logged-in routes
   * thereafter). Forces concurrency to 1 (a profile is a single session).
   */
  userDataDir?: string;
  /** Run with a visible browser window (default: headless). */
  headed?: boolean;
  /**
   * Called once when a fresh (empty) `userDataDir` profile is opened on the
   * target URL, so the user can sign in before measurement begins. Resolves
   * when setup is complete. The CLI wires this to an interactive "press Enter"
   * prompt; programmatic callers can automate login here instead.
   */
  onProfileInit?: () => Promise<void>;
}
