import type { ClientConfig } from '@vitalsage/types';

export interface VitalSageInstance {
  stop: () => void;
}

const NOOP_INSTANCE: VitalSageInstance = { stop: () => {} };

let activeInstance: VitalSageInstance | null = null;

export function init(_config: ClientConfig): VitalSageInstance {
  if (typeof window === 'undefined') return NOOP_INSTANCE;
  if (activeInstance) return activeInstance;
  // Full implementation in Phase 5
  activeInstance = NOOP_INSTANCE;
  return activeInstance;
}
