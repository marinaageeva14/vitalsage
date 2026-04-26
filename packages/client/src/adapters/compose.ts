import type { StorageAdapter } from '@vitalsage/types';

/**
 * Merges multiple StorageAdapters into one.
 * Each adapter's callbacks are called in order; all receive the same data.
 *
 * @example
 * init({
 *   storage: {
 *     adapter: composeAdapters(
 *       createLoggingAdapter({ label: 'app' }),
 *       serverAdapter,
 *     ),
 *   },
 * });
 */
export function composeAdapters(...adapters: StorageAdapter[]): StorageAdapter {
  return {
    async onInteraction(interaction) {
      for (const a of adapters) {
        await a.onInteraction?.(interaction);
      }
    },
  };
}
