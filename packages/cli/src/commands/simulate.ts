import type { SimulatorConfig, NetworkProfile, ViewportProfile } from '@vitalsage/types';
import { printSuccess, printError, printInfo } from '../output/terminal.js';
import { ProgressBar } from '../output/progress.js';

export interface SimulateArgs {
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
  };

  printInfo(`Simulating ${args.runs} runs against ${args.url}`);
  printInfo(`Output: ${args.output}`);

  const progress = new ProgressBar(args.runs, 'Simulating');

  const simulator = new PlaywrightSimulator();

  const patchedConfig: SimulatorConfig = {
    ...config,
    waitAfterLoad: config.waitAfterLoad ?? 2000,
  };

  try {
    const sessions = await simulator.simulate({
      ...patchedConfig,
      runs: args.runs,
    });
    progress.complete();
    printSuccess(`Collected ${sessions.length} sessions → ${args.output}`);
  } catch (err) {
    progress.complete();
    printError(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
