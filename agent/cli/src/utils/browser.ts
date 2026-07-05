import type { SimulatorConfig } from '@vitalsage/types';
import { waitForEnter } from './prompt.js';

export interface BrowserOpts {
  browserChannel?: string;
  userDataDir?:    string;
  headed?:         boolean;
}

/**
 * Build the browser-related fields of a SimulatorConfig from CLI options:
 * system-browser channel, persistent profile (for authenticated tracing), and
 * headed mode. When a profile dir is given, wires the interactive login prompt
 * so a fresh profile pauses for sign-in before measuring.
 */
export function browserConfig(opts: BrowserOpts): Partial<SimulatorConfig> {
  return {
    ...(opts.browserChannel ? { browserChannel: opts.browserChannel } : {}),
    ...(opts.headed         ? { headed: true }                        : {}),
    ...(opts.userDataDir
      ? {
          userDataDir:   opts.userDataDir,
          onProfileInit: async () => {
            await waitForEnter(
              '\n  🔑 A browser window opened on the target page. Log in if needed, ' +
              'then press Enter here to start tracing… ',
            );
          },
        }
      : {}),
  };
}
