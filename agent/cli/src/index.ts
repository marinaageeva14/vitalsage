import { runSimulate } from './commands/simulate.js';
import { runAnalyze }  from './commands/analyze.js';
import { runReport }   from './commands/report.js';
import { runTrace }    from './commands/trace.js';
import { runCapture }  from './commands/capture.js';
import { runFix }      from './commands/fix.js';
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

/**
 * Shared browser options for the commands that drive a browser (simulate,
 * trace, capture, fix). Each flag also falls back to an env var so it can be
 * set once for a whole session.
 */
function getBrowserOpts(args: Map<string, unknown>): {
  browserChannel?: string; userDataDir?: string; headed?: boolean;
} {
  const browserChannel = getString(args, 'browserChannel') ?? process.env['VITALSAGE_BROWSER_CHANNEL'];
  const userDataDir    = getString(args, 'userDataDir')    ?? process.env['VITALSAGE_USER_DATA_DIR'];
  const headed = args.get('headed') === true || args.get('headed') === 'true'
    || process.env['VITALSAGE_HEADED'] === '1';
  return {
    ...(browserChannel ? { browserChannel } : {}),
    ...(userDataDir    ? { userDataDir }    : {}),
    ...(headed         ? { headed: true }   : {}),
  };
}

const USAGE = `
VitalSage — Web Performance Analysis Tool

Usage:
  vitalsage simulate --url <url> [options]
  vitalsage analyze  --sessions <dir> [options]
  vitalsage report   --input <file> --output <file>
  vitalsage trace    --url <url> [options]
  vitalsage capture  <url> [options]
  vitalsage fix      --url <url> --source <dir> --retries <n> --ai-key <key> --ai-provider <provider>

Commands:
  simulate    Run synthetic sessions using Playwright
  analyze     Analyze sessions and generate suggestions
  report      Generate HTML report from saved analysis JSON
  trace       Capture and analyze a performance trace on-demand
  capture     Enrich a stored real-user interaction with a CDP flame-graph trace
  fix         Autonomously measure → audit → fix → verify in a loop (requires --retries)

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
  --delay        Ms to wait between runs (default: 2000)
  --full-report  Enable V8 CPU profiler for per-function flame chart data.
                 Same data source as Chrome DevTools Performance tab.
                 Warning: adds ~10–15% overhead and produces larger traces.
  --output       Save report to file (.html or .json); default: report-YYYY-MM-DD.html
  --ai-provider  AI provider: anthropic | openai | gemini
  --ai-key       API key for AI provider
  --ai-model     Model name override

Commands (capture):
  vitalsage capture <url> [options]

  Enriches a stored real-user interaction on the VitalSage server with a
  CDP-based flame-graph trace captured via Playwright.  Combines real CWV
  distributions (p75 LCP, CLS, INP…) with trace-derived main-thread data
  for deeper analysis.

Options (capture):
  --url          URL to capture (positional or --url)
  --server       VitalSage server base URL (default: http://localhost:3001)
  --app          App name filter when fetching interactions (default: unknown)
  --runs         Number of Playwright trace runs to average (default: 3)
  --network      Network throttle profile: wifi 4g 3g slow-2g (default: 4g)
  --viewport     Viewport profile: desktop tablet mobile (default: desktop)
  --full-report  Capture per-function flame chart (V8 CPU Profiler, higher overhead)
  --output       Save HTML/JSON report to file
  --no-server    Skip server fetch/patch — analyse trace-only sessions
  --ai-provider  AI provider: anthropic | openai | gemini
  --ai-key       API key for AI provider
  --ai-model     Model name override

Options (fix):
  --url          Page URL to audit and fix (required)
  --source       Path to your source directory — HTML/CSS/JS files to edit (required)
  --retries      Number of fix-and-verify cycles to attempt (REQUIRED, no default)
                 Each retry calls the AI and runs Playwright measurements.
                 Recommended: 3–5 for typical issues, max 10 for complex pages.
  --ai-provider  AI provider: anthropic | openai | gemini (required)
  --ai-key       API key for the AI provider (required)
  --ai-model     Model name override (optional)
  --runs         Playwright runs per measurement pass (default: 5)
  --network      Network profile: 4g | 3g (default: 4g)
  --viewport     Viewport: desktop | mobile (default: desktop)

Browser options (simulate, trace, capture, fix):
  --browser-channel <name>  Drive a system-installed browser (chrome | msedge)
                            instead of bundled Chromium — for machines whose OS
                            is too old for the bundled browser.
                            Env: VITALSAGE_BROWSER_CHANNEL
  --user-data-dir <path>    Reuse a persistent Chrome profile across runs. Lets
                            you trace pages behind login: a fresh profile opens
                            headed so you can sign in once, then later runs reuse
                            the session. Env: VITALSAGE_USER_DATA_DIR
  --headed                  Show the browser window (default: headless).
                            Env: VITALSAGE_HEADED=1

Example — trace an authenticated page with your local Chrome:
  vitalsage trace \\
    --url https://app.example.com/dashboard \\
    --browser-channel chrome \\
    --user-data-dir ~/.vitalsage-chrome \\
    --output report.html

Example:
  vitalsage fix \\
    --url http://localhost:5173 \\
    --source ./src \\
    --retries 5 \\
    --ai-provider anthropic \\
    --ai-key \$ANTHROPIC_API_KEY
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
      ...getBrowserOpts(args),
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
    const aiProvider  = getString(args, 'aiProvider');
    const aiKey       = getString(args, 'aiKey');
    const aiModel     = getString(args, 'aiModel');
    const output      = getString(args, 'output');
    const fullReport  = args.get('fullReport') === true || args.get('fullReport') === 'true';
    await runTrace({
      url,
      runs:     getNumber(args, 'runs', 3),
      network:  getString(args, 'network')  ?? '4g',
      viewport: getString(args, 'viewport') ?? 'desktop',
      delay:    getNumber(args, 'delay', 2000),
      fullReport,
      ...(aiProvider ? { aiProvider } : {}),
      ...(aiKey      ? { aiKey }      : {}),
      ...(aiModel    ? { aiModel }    : {}),
      ...(output     ? { output }     : {}),
      ...getBrowserOpts(args),
    });
    return;
  }

  if (cmd === 'capture') {
    // Positional: `vitalsage capture https://example.com` OR `--url https://example.com`
    const positionalUrl = rest.find(a => !a.startsWith('--'));
    const url = getString(args, 'url') ?? positionalUrl;
    if (!url) { printError('URL is required — e.g. vitalsage capture https://example.com'); process.exit(1); }
    const aiProvider = getString(args, 'aiProvider');
    const aiKey      = getString(args, 'aiKey');
    const aiModel    = getString(args, 'aiModel');
    const output     = getString(args, 'output');
    const server     = getString(args, 'server');
    const app        = getString(args, 'app');
    const network    = getString(args, 'network');
    const viewport   = getString(args, 'viewport');
    const fullReport = args.get('fullReport') === true || args.get('fullReport') === 'true';
    const noServer   = args.get('noServer')   === true || args.get('noServer')   === 'true';
    await runCapture({
      url,
      runs:     getNumber(args, 'runs', 3),
      fullReport,
      noServer,
      ...(server     ? { server }     : {}),
      ...(app        ? { app }        : {}),
      ...(network    ? { network }    : {}),
      ...(viewport   ? { viewport }   : {}),
      ...(aiProvider ? { aiProvider } : {}),
      ...(aiKey      ? { aiKey }      : {}),
      ...(aiModel    ? { aiModel }    : {}),
      ...(output     ? { output }     : {}),
      ...getBrowserOpts(args),
    });
    return;
  }

  if (cmd === 'fix') {
    const url        = getString(args, 'url');
    const source     = getString(args, 'source');
    const aiProvider = getString(args, 'aiProvider');
    const aiKey      = getString(args, 'aiKey');
    const retriesRaw = getString(args, 'retries');

    // --retries is REQUIRED with no default — prevents unbounded token spend
    if (!retriesRaw) {
      printError('--retries <n> is required for the fix command.');
      printError('Example: vitalsage fix --url http://localhost:5173 --source ./src --retries 3 --ai-provider anthropic --ai-key $ANTHROPIC_API_KEY');
      process.exit(1);
    }
    const retries = parseInt(retriesRaw, 10);
    if (isNaN(retries) || retries < 1) {
      printError('--retries must be a positive integer (e.g. --retries 3)');
      process.exit(1);
    }
    if (!url)        { printError('--url is required');         process.exit(1); }
    if (!source)     { printError('--source is required');      process.exit(1); }
    if (!aiProvider) { printError('--ai-provider is required'); process.exit(1); }
    if (!aiKey)      { printError('--ai-key is required');      process.exit(1); }

    const network  = getString(args, 'network')  as '4g' | '3g' | undefined;
    const viewport = getString(args, 'viewport') as 'desktop' | 'mobile' | undefined;
    const aiModel  = getString(args, 'aiModel');

    await runFix({
      url,
      source,
      retries,
      aiProvider,
      aiKey,
      ...(aiModel  ? { aiModel }  : {}),
      ...(network  ? { network }  : {}),
      ...(viewport ? { viewport } : {}),
      runs: getNumber(args, 'runs', 5),
      ...getBrowserOpts(args),
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
