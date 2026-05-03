import type { ThresholdConfig } from './metrics.js';
import type { AgentName } from './suggestions.js';

export interface RouteConfig {
  pattern:     string;
  label?:      string;
  thresholds?: Partial<ThresholdConfig>;
  agents?:     AgentName[] | 'all';
  sampling?:   number;
}

export interface RouteContext {
  pattern:         string;
  label?:          string;
  path:            string;
  visitId:         string;
  navigationIndex: number;
}

export type NavigationMode = 'auto' | 'spa' | 'mpa';
