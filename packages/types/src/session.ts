import type { RouteContext } from './routing.js';
import type { DeviceContext, PageContext } from './context.js';
import type { CoreWebVitals, MetricName, MetricRating, NavigationType } from './metrics.js';

export interface SessionReport {
  sessionId:  string;
  visitId:    string;
  route:      RouteContext;
  url:        string;
  timestamp:  number;
  device:     DeviceContext;
  page:       PageContext;
  metrics:    CoreWebVitals;
  synthetic:  boolean;
  sdkVersion: string;
}

export interface MetricDataPoint {
  sessionId:      string;
  visitId:        string;
  name:           MetricName;
  value:          number;
  rating:         MetricRating;
  delta:          number;
  route:          RouteContext;
  timestamp:      number;
  navigationType: NavigationType;
}
