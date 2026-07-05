import type { SimulatorConfig, NetworkProfile, ViewportProfile } from '@vitalsage/types';
import { printSuccess, printError, printInfo } from '../output/terminal.js';
import { ProgressBar } from '../output/progress.js';
import { browserConfig, type BrowserOpts } from '../utils/browser.js';

export interface SimulateArgs extends BrowserOpts {
  url:         string;
  runs:        number;
  routes?:     string[];
  networks?:   string[];
  viewports?:  string[];
  output:      string;
  concurrency: number;
}

export async function runSimulate(args: SimulateArgs): Promise<void> {
  const { PlaywrightSimulator } = await import('vitalsage-simulator');

  const config: SimulatorConfig = {
    url:         args.url,
    runs:        args.runs,
    outputDir:   args.output,
    concurrency: args.concurrency,
    ...(args.routes   ? { routes:   args.routes }                              : {}),
    ...(args.networks ? { networks: args.networks as NetworkProfile[] }        : {}),
    ...(args.viewports ? { viewports: args.viewports as ViewportProfile[] }    : {}),
    ...browserConfig(args),
  };

  printInfo(`Simulating ${args.runs} runs against ${args.url}`);
  printInfo(`Output: ${args.output}`);

  const progress  = new ProgressBar(args.runs, 'Simulating');
  const simulator = new PlaywrightSimulator();

  // Patch console.log to tick the progress bar on each simulator log line
  const origLog   = console.log.bind(console);
  console.log     = (...a: unknown[]) => {
    const msg = String(a[0] ?? '');
    if (msg.includes('[VitalSage Simulator]') && /\d+\/\d+ runs complete/.test(msg)) {
      const match = msg.match(/(\d+)\/\d+ runs complete/);
      if (match) {
        const done = parseInt(match[1]!, 10);
        // tick to current done count
        progress['current'] = 0;
        for (let i = 0; i < done; i++) progress.tick();
      }
    } else {
      origLog(...a);
    }
  };

  try {
    const sessions = await simulator.simulate(config);
    console.log = origLog;
    progress.complete();
    printSuccess(`Collected ${sessions.length} sessions → ${args.output}`);
  } catch (err) {
    console.log = origLog;
    progress.complete();
    printError(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
