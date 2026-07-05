import { createInterface } from 'node:readline';

/**
 * Block until the user presses Enter. Used for the interactive login step when
 * tracing authenticated pages: the browser opens on a fresh profile, the user
 * signs in, then presses Enter to let measurement proceed.
 */
export function waitForEnter(message: string): Promise<void> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}
