import type { MetricName } from './metrics.js';

export type AgentName =
  | 'lcp'
  | 'cls'
  | 'inp'
  | 'ttfb'
  | 'render-block'
  | 'resource-hint'
  | 'image'
  | 'font';

export type Severity = 'critical' | 'warning' | 'info';
export type Effort   = 'low' | 'medium' | 'high';

export interface Suggestion {
  id:               string;
  agent:            AgentName;
  metric:           MetricName;
  severity:         Severity;
  title:            string;
  detail:           string;
  effort:           Effort;
  estimatedImpact:  string;
  affectedSessions?: number;
  affectedPercent?:  number;
  confidence:       number;
  codeExample?: {
    before:   string;
    after:    string;
    language: 'html' | 'javascript' | 'css' | 'http' | 'bash';
  };
  learnMore?: string;
}
