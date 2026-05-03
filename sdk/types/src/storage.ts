import type { Interaction } from './interaction.js';

export interface StorageAdapter {
  onInteraction?: (interaction: Interaction) => void | Promise<void>;
}

/** @deprecated No longer used by the client SDK — kept for backward compatibility. */
export interface BatchingConfig {
  enabled:        boolean;
  maxSize?:       number;
  flushInterval?: number;
}
