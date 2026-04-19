#!/usr/bin/env node
import { runSimulate } from './commands/simulate.js';
import { runAnalyze }  from './commands/analyze.js';
import { runReport }   from './commands/report.js';
import { runTrace }    from './commands/trace.js';
import { printError }  from './output/terminal.js';

function parseArgs(argv: string[]): Map<string, string | string[] | boolean> {
  const result = new Map<string, string | string[] | boolean>();
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        result.set(key, true);
        i++;
      } else {
        const values: string[] = [];
        i++;
        while (i < argv.length && !argv[i]!.startsWith('--')) {
          values.push(argv[i]!);
          i++;
        }
        result.set(key, values.length === 1 ? values[0]! : values);
      }
    } else {
      i++;
    }
  }
  return result;
}

function getString(args: Map<string, unknown>, key: string): string | undefined {
  const v = args.get(key);
  return typeof v === 'string' ? v : undefined;
}

function getNumber(args: Map<string, unknown>, key: string, def: number): number {
  const v = args.get(key);
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }
  return def;
}

function getStringArray(args: Map<string, unknown>, key: string): string[] | undefined {
  const v = args.get(key);
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') return [v];
  return undefined;
}

const USAGE = `
VitalSage — Web Performance Analysis Tool

Usage:
  vitalsage simulate --url <url> [options]
  vitalsage analyze  --sessions <dir> [options]
  vitalsage report   --input <file> --output <file>
  vitalsage trace    --url <url> [options]

Commands:
  simulate    Run synthetic sessions using Playwright
  analyze     Analyze sessions and generate suggestions
  report      Generate HTML report from saved analysis JSON
  trace       Capture and analyze a performance trace on-demand

Options (simulate):
  --url         URL to simulate (required)
  --runs        Number of runs (default: 50)
  --routes      Routes to test (default: /)
  --networks    Network profiles: wifi 4g 3g 2g slow-2g (default: 4g 3g slow-2g)
  --viewports   Viewport profiles: desktop tablet mobile (default: desktop mobile)
  --output      Output directory (default: ./vitalsage-data)
  --concurrency Max parallel browsers (default: 3)

Options (analyze):
  --sessions      Directory with session JSON files
  --sessions-url  HTTP endpoint returning session JSON
  --sessions-auth Authorization header value (e.g. "Bearer token")
  --ai-provider   AI provider: anthropic | openai | gemini
  --ai-key        API key for AI provider
  --ai-model      Model name override
  --format        Output format: terminal | html | json (default: terminal)
  --output        Output file path (for html/json format)
  --min-samples   Minimum sessions per route (default: 50)

Options (report):
  --input   Input analysis JSON file
  --output  Output HTML file

Options (trace):
  --url          URL to trace (required)
  --runs         Number of trace runs (default: 3)
  --network      Network profile: wifi 4g 3g slow-2g (default: 4g)
  --viewport     Viewport profile: desktop tablet mobile (default: desktop)
  --output       Save report to file (.html or .json)
  --ai-provider  AI provider: anthropic | openai | gemini
  --ai-key       API key for AI provider
  --ai-model     Model name override
`.trim();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd  = argv[0];
  const rest = argv.slice(1);
  const args = parseArgs(rest);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  if (cmd === 'simulate') {
    const url = getString(args, 'url');
    if (!url) { printError('--url is required'); process.exit(1); }
    const routes   = getStringArray(args, 'routes');
    const networks = getStringArray(args, 'networks');
    const viewports = getStringArray(args, 'viewports');
    await runSimulate({
      url,
      runs:        getNumber(args, 'runs', 50),
      output:      getString(args, 'output') ?? './vitalsage-data',
      concurrency: getNumber(args, 'concurrency', 3),
      ...(routes    ? { routes }    : {}),
      ...(networks  ? { networks }  : {}),
      ...(viewports ? { viewports } : {}),
    });
    return;
  }

  if (cmd === 'analyze') {
    const sessions    = getString(args, 'sessions');
    const sessionsUrl = getString(args, 'sessionsUrl');
    if (!sessions && !sessionsUrl) {
      printError('Provide --sessions <dir> or --sessions-url <url>');
      process.exit(1);
    }
    const format       = (getString(args, 'format') ?? 'terminal') as 'terminal' | 'html' | 'json';
    const sessionsAuth = getString(args, 'sessionsAuth');
    const aiProvider   = getString(args, 'aiProvider');
    const aiKey        = getString(args, 'aiKey');
    const aiModel      = getString(args, 'aiModel');
    const output       = getString(args, 'output');
    await runAnalyze({
      format,
      minSamples: getNumber(args, 'minSamples', 50),
      ...(sessions     ? { sessions }     : {}),
      ...(sessionsUrl  ? { sessionsUrl }  : {}),
      ...(sessionsAuth ? { sessionsAuth } : {}),
      ...(aiProvider   ? { aiProvider }   : {}),
      ...(aiKey        ? { aiKey }        : {}),
      ...(aiModel      ? { aiModel }      : {}),
      ...(output       ? { output }       : {}),
    });
    return;
  }

  if (cmd === 'report') {
    const input  = getString(args, 'input');
    const output = getString(args, 'output');
    if (!input)  { printError('--input is required');  process.exit(1); }
    if (!output) { printError('--output is required'); process.exit(1); }
    await runReport({ input, output });
    return;
  }

  if (cmd === 'trace') {
    const url = getString(args, 'url');
    if (!url) { printError('--url is required'); process.exit(1); }
    const aiProvider = getString(args, 'aiProvider');
    const aiKey      = getString(args, 'aiKey');
    const aiModel    = getString(args, 'aiModel');
    const output     = getString(args, 'output');
    await runTrace({
      url,
      runs:     getNumber(args, 'runs', 3),
      network:  getString(args, 'network')  ?? '4g',
      viewport: getString(args, 'viewport') ?? 'desktop',
      ...(aiProvider ? { aiProvider } : {}),
      ...(aiKey      ? { aiKey }      : {}),
      ...(aiModel    ? { aiModel }    : {}),
      ...(output     ? { output }     : {}),
    });
    return;
  }

  printError(`Unknown command: ${cmd}`);
  console.log('Run `vitalsage --help` for usage.');
  process.exit(1);
}

main().catch(err => {
  printError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
