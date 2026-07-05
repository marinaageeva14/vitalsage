import type { SimulatorConfig } from '@vitalsage/types';
import { waitForEnter } from './prompt.js';

export interface BrowserOpts {
  browserChannel?: string;
  userDataDir?:    string;
  headed?:         boolean;
  /** Force the sign-in step even if the profile already exists. Implies headed. */
  login?:          boolean;
}

/**
 * Build the browser-related fields of a SimulatorConfig from CLI options:
 * system-browser channel, persistent profile (for authenticated tracing),
 * headed mode, and the sign-in step. When a profile dir is given, wires the
 * interactive login prompt; `login` forces it even on an existing profile.
 */
export function browserConfig(opts: BrowserOpts): Partial<SimulatorConfig> {
  return {
    ...(opts.browserChannel ? { browserChannel: opts.browserChannel } : {}),
    ...((opts.headed || opts.login) ? { headed: true } : {}),
    ...(opts.userDataDir
      ? {
          userDataDir: opts.userDataDir,
          ...(opts.login ? { forceLogin: true } : {}),
          onProfileInit: async () => {
            await waitForEnter(
              '\n  🔑 A browser window is open on the target page. Log in if needed, ' +
              'then press Enter here to start tracing… ',
            );
          },
        }
      : {}),
  };
}
