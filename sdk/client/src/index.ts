export { init }                       from './core.js';
export type { VitalSageInstance }      from './core.js';
export { createLoggingAdapter }       from './adapters/logging.js';
export type { LoggingAdapterOptions } from './adapters/logging.js';
export { composeAdapters }            from './adapters/compose.js';
export type {
  ClientConfig,
  StorageAdapter,
  Interaction,
  InteractionType,
  InteractionStatus,
  MetricSnapshot,
  RouteConfig,
} from '@vitalsage/types';
