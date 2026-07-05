# VitalSage

Open-source browser performance SDK with AI-powered analysis. Captures real-user Core Web Vitals, main-thread traces, and page context — then routes findings through rule-based agents and an optional LLM for actionable suggestions.

```
sdk/client  (vitalsage)
  └─ captures CWV + long tasks + page context in the browser
  └─ posts Interaction to your collection server

platform/examples/server
  └─ stores interactions in SQLite
  └─ /api/audit streams AnalysisReport per route via SSE

agent/cli  (vitalsage)
  └─ simulate   → synthetic Playwright runs
  └─ analyze    → off-line analysis from JSON files
  └─ trace      → on-demand CDP flame-graph
  └─ capture    → enriches real sessions with a trace
  └─ report     → regenerate HTML from saved JSON
  └─ fix        → autonomous measure → audit → fix → verify loop

agent/mcp  (vitalsage-mcp)
  └─ MCP server for Claude Code / Cursor / any MCP client
  └─ measure → analyze → DOM inspect → compare → audit
  └─ enables autonomous performance debugging by AI agents
```

---

## Get Started

Up and running in a few minutes. Pick a path once the setup steps are done.

### Prerequisites

- **Node.js ≥ 18** (developed on 22)
- **pnpm ≥ 9** — install with `npm install -g pnpm`

### 1. Install & build

```bash
git clone https://github.com/marinaageeva14/vitalsage.git
cd vitalsage
pnpm install
pnpm build
```

### 2. Install the browser engine

The `simulate`, `trace`, `capture`, and `fix` commands drive a real Chromium through Playwright:

```bash
pnpm exec playwright install chromium
```

That's the whole setup. Now choose a path.

### Path A — Audit any live URL (fastest, zero config)

Measure Core Web Vitals plus a main-thread trace for any page and save an HTML report:

```bash
node agent/cli/dist/index.cjs trace \
  --url https://example.com \
  --runs 3 \
  --output report.html
```

Open `report.html` in a browser. No server and no API key required — the rule-based agents produce findings on their own. Add AI-generated suggestions with `--ai-provider` and `--ai-key` (see below).

> **Tip:** link the CLI globally so you can just type `vitalsage`:
> ```bash
> cd agent/cli && pnpm link --global && cd -
> vitalsage trace --url https://example.com --output report.html
> ```

### Path B — Run the full demo stack (SDK → server → app)

See the browser SDK collecting real-user data end to end. Use two terminals:

```bash
# Terminal 1 — collection server → http://localhost:3001
cd platform/examples/server && pnpm dev

# Terminal 2 — example app → http://localhost:5173
cd platform/examples/vanilla && pnpm dev
```

Browse http://localhost:5173 (open the console to watch metrics stream), then analyze what was collected:

```bash
curl "http://localhost:3001/api/audit?app=vanilla&minSamples=1"
```

### Enable AI-powered suggestions (optional)

VitalSage works without an LLM, but a provider turns raw metrics into specific, prioritized fixes. Supported providers: `anthropic`, `openai`, `gemini`.

```bash
# With the CLI
node agent/cli/dist/index.cjs trace \
  --url https://example.com \
  --ai-provider anthropic \
  --ai-key "$ANTHROPIC_API_KEY" \
  --output report.html

# With the example server (enables AI enhancement on /api/audit)
export ANTHROPIC_API_KEY=sk-ant-...
cd platform/examples/server && pnpm dev
```

Any OpenAI-compatible endpoint also works via `--ai-provider openai` with `OPENAI_BASE_URL` set (e.g. NVIDIA NIM or a local model server).

New to the project? The [Quick Start](#quick-start) and the per-package sections below go deeper.

---

## Table of Contents

**New here? Jump to [Get Started](#get-started).**

1. [Monorepo Structure](#monorepo-structure)
2. [Quick Start](#quick-start)
3. [Browser SDK — `vitalsage`](#browser-sdk--vitalsage)
   - [Installation](#installation)
   - [init()](#init)
   - [ClientConfig](#clientconfig)
   - [StorageAdapter](#storageadapter)
   - [Adapters](#adapters)
   - [Interaction shape](#interaction-shape)
   - [PageContext](#pagecontext)
   - [TraceMetrics (browser-collected)](#tracemetrics-browser-collected)
4. [Example Server](#example-server)
   - [Endpoints](#endpoints)
   - [AI audit via SSE](#ai-audit-via-sse)
5. [CLI — `vitalsage`](#cli--vitalsage)
   - [simulate](#simulate)
   - [analyze](#analyze)
   - [trace](#trace)
   - [capture](#capture)
   - [report](#report)
   - [fix](#fix)
6. [Analysis Engine — `vitalsage-analysis`](#analysis-engine--vitalsage-analysis)
   - [Agents](#agents)
   - [Metric thresholds](#metric-thresholds)
   - [Trace agent thresholds](#trace-agent-thresholds)
7. [Simulator — `vitalsage-simulator`](#simulator--vitalsage-simulator)
8. [MCP Server — `vitalsage-mcp`](#mcp-server--vitalsage-mcp)
   - [Setup](#setup)
   - [Tools](#tools)
   - [Autonomous debug loop](#autonomous-debug-loop)
9. [Framework Integration Examples](#framework-integration-examples)
   - [Vanilla JS / HTML](#vanilla-js--html)
   - [React](#react)
   - [Next.js](#nextjs)
10. [Development](#development)

---

## Monorepo Structure

```
vitalsage/
├── sdk/
│   ├── client/        vitalsage            Browser SDK (ESM, CJS, IIFE)
│   ├── simulator/     vitalsage-simulator  Playwright synthetic runner
│   └── types/         @vitalsage/types     Shared TypeScript types
├── agent/
│   ├── analysis/      vitalsage-analysis   Analysis engine + 9 agents + AI
│   ├── cli/           vitalsage-cli        CLI tool (globally linked)
│   └── mcp/           vitalsage-mcp        MCP server for Claude Code integration
└── platform/
    └── examples/
        ├── vanilla/        Multi-page HTML demo
        ├── react/          React + React Router demo
        ├── nextjs/         Next.js 14 App Router demo
        └── server/         Express + SQLite collection server
```

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build all packages
pnpm build

# 3. Start the collection server
cd platform/examples/server && pnpm dev
# → http://localhost:3001

# 4. Start an example app (in a new terminal)
cd platform/examples/vanilla && pnpm dev
# → http://localhost:5173

# 5. Browse the app — interactions are posted to the server automatically
#    Open browser console to see VitalSage logging metrics in real time

# 6. Run analysis over collected data
curl "http://localhost:3001/api/audit?app=vanilla&minSamples=1"
```

To enable AI-enhanced suggestions, set an API key before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Claude (recommended)
# or
export OPENAI_API_KEY=sk-...          # GPT-4o
# or
export GEMINI_API_KEY=...             # Gemini 1.5 Pro

cd platform/examples/server && pnpm dev
```

---

## Browser SDK — `vitalsage`

### Installation

```bash
npm install vitalsage
# or
pnpm add vitalsage
```

Peer dependency: `web-vitals >= 3.0.0`

```bash
npm install web-vitals
```

### init()

```typescript
import { init } from 'vitalsage';

const instance = init(config);

// Later, to tear down (e.g. in tests):
instance.stop();
```

`init()` is idempotent — calling it twice returns the existing instance and logs a warning when `debug: true`. Call `instance.stop()` first to reinitialise.

### ClientConfig

```typescript
interface ClientConfig {
  storage: {
    adapter: StorageAdapter;
  };

  /**
   * Fraction of sessions to instrument. Useful in high-traffic production.
   * 1.0 = capture all (default), 0.1 = capture 10% at random.
   */
  sampling?: number;  // default: 1.0

  /**
   * Route patterns for custom SPA navigation matching.
   * Not required for most apps — the SDK detects navigation automatically.
   */
  routes?: RouteConfig[];

  /**
   * Control how URL changes are detected as new interactions.
   * 'auto'     - uses Navigation API when available, falls back to History API patching (default)
   * 'pathname' - triggers only on pathname changes, ignores query string / hash
   * 'custom'   - disables auto-detection; call instance navigation API manually
   */
  navigation?: {
    mode: 'auto' | 'pathname' | 'custom';
  };

  /** Log extra diagnostic info to the console. default: false */
  debug?: boolean;
}
```

### StorageAdapter

```typescript
interface StorageAdapter {
  /**
   * Called once per completed interaction (page load or SPA navigation).
   * Can be async — errors are caught and logged as warnings.
   */
  onInteraction?: (interaction: Interaction) => void | Promise<void>;
}
```

A minimal server adapter:

```typescript
const serverAdapter: StorageAdapter = {
  onInteraction: async (interaction) => {
    await fetch('https://your-server.com/api/interaction', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ app: 'my-app', ...interaction }),
    });
  },
};
```

### Adapters

**`createLoggingAdapter(options?)`** — pretty-prints each interaction to the browser console.

```typescript
import { init, createLoggingAdapter } from 'vitalsage';

init({
  storage: {
    adapter: createLoggingAdapter({
      label:   'my-app',  // shown in the group header
      enabled: true,      // toggle without removing from chain (default: true)
      verbose: false,     // also log the full interaction object (default: false)
    }),
  },
});
```

Output format:
```
▼ [VitalSage] my-app — INITIAL_LOAD ✅  1 234ms
  🟢 LCP   1 450ms
  🟢 FCP     820ms
  🟢 TTFB    210ms
  🟢 CLS   0.000
  ⚪ INP       –
```

**`composeAdapters(...adapters)`** — chains multiple adapters, called sequentially in order.

```typescript
import { init, createLoggingAdapter, composeAdapters } from 'vitalsage';

const serverAdapter    = { onInteraction: async (i) => { /* send to server    */ } };
const analyticsAdapter = { onInteraction:       (i) => { /* send to analytics */ } };

init({
  storage: {
    adapter: composeAdapters(
      createLoggingAdapter({ label: 'app' }),  // 1st
      serverAdapter,                            // 2nd
      analyticsAdapter,                         // 3rd
    ),
  },
});
```

### Interaction shape

```typescript
interface Interaction {
  id:        string;            // Unique ID for this interaction
  type:      'INITIAL_LOAD'     // Hard page load (or first load in SPA)
           | 'NAVIGATION';      // SPA route change

  status:    'success'          // Interaction completed normally
           | 'cancel'           // New navigation before this one settled — page context absent
           | 'timeout'          // 60-second hard timeout
           | 'fail';            // [data-interaction-error] attribute detected

  uri:       string;            // URL when interaction started
  referrer:  string | null;     // document.referrer (INITIAL_LOAD) or previous URI (NAVIGATION)
  timestamp: number;            // Unix ms when interaction started
  duration:  number;            // ms from start to completion

  metrics: {
    LCP?:  { value: number; rating: 'good' | 'needs-improvement' | 'poor' };
    FCP?:  { value: number; rating: '...' };
    TTFB?: { value: number; rating: '...' };
    CLS?:  { value: number; rating: '...' };
    INP?:  { value: number; rating: '...' };
  };

  device: DeviceContext;   // Viewport, connection type, device category
  page?:  PageContext;     // Present on success/fail/timeout; absent on cancel
}
```

**Metric rating thresholds** (aligned with Google CrUX):

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP    | ≤ 2500ms | ≤ 4000ms | > 4000ms |
| FCP    | ≤ 1800ms | ≤ 3000ms | > 3000ms |
| TTFB   | ≤ 800ms  | ≤ 1800ms | > 1800ms |
| CLS    | ≤ 0.1    | ≤ 0.25   | > 0.25   |
| INP    | ≤ 200ms  | ≤ 500ms  | > 500ms  |

### PageContext

Collected at interaction completion (all statuses except `cancel`):

```typescript
interface PageContext {
  url:          string;
  referrer:     string;
  title:        string;
  domNodeCount: number;              // Total DOM nodes at completion

  resources:        ResourceEntry[];       // Up to 250 resource timing entries
  lcpElement?:      LCPElementDescriptor;  // Tag, src, fetchpriority, dimensions
  fonts:            FontEntry[];           // @font-face declarations + preload status
  images:           ImageEntry[];          // All <img> elements + above-fold/LCP markers
  scripts:          ScriptEntry[];         // All <script> elements + render-blocking flags
  stylesheets:      StylesheetEntry[];     // All <link rel="stylesheet"> elements
  navigationTiming: NavigationTimingSnapshot; // DNS, TLS, server, parse, download times

  traceMetrics?: TraceMetrics;   // Populated by LongTask/LoAF observers (no CDP needed)
  screenshot?:   string;         // base64 JPEG — only on simulator captureTrace runs
}
```

### TraceMetrics (browser-collected)

The SDK uses two `PerformanceObserver` entry types to populate `TraceMetrics` in every real-user session — no Playwright or CDP required:

| Entry type | Browser support | Provides |
|---|---|---|
| `longtask` | Chrome 58+, Firefox 82+, Edge 79+ | `longTasks[]`, `longTaskCount`, TBT (fallback), `mainThreadWork` (fallback) |
| `long-animation-frame` (LoAF) | Chrome 123+ | Accurate `totalBlockingTime`, `mainThreadWork`, `scriptingTime`, `renderingTime`, `topScripts` |

```typescript
interface TraceMetrics {
  totalBlockingTime:  number;        // ms of main-thread blocking (sum of task − 50ms portions)
  longTaskCount:      number;        // count of tasks > 50ms
  longTasks:          LongTask[];    // top-20 tasks: { startTime, duration, blocking }
  mainThreadWork:     number;        // total CPU time on main thread (ms)
  scriptingTime:      number;        // JS execution time (ms)
  jsCompileTime:      number;        // JS parse + compile time (ms) — 0 from browser, set by CDP trace
  renderingTime:      number;        // style recalc + layout time (ms) — from LoAF render phase
  layoutCount:        number;        // forced layout count — 0 from browser, set by CDP trace
  styleRecalcCount:   number;        // style recalc count — 0 from browser, set by CDP trace
  domNodes:           number;        // DOM node count at interaction completion
  jsListeners:        number;        // event listener count — 0 from browser, set by CDP trace
  jsHeapUsed?:        number;        // JS heap used in bytes (Chrome only, via performance.memory)
  topScripts?:        ScriptActivity[];    // per-script time from LoAF; present on Chrome 123+
  topFunctions?:      FunctionProfile[];  // per-function CPU profile; only from vitalsage capture --full-report
}
```

> Fields marked "0 from browser" require CDP trace events (available via `vitalsage capture --full-report`). All TraceAgent rules check `> threshold`, so `0` never produces a false positive.

---

## Example Server

The reference collection server (`platform/examples/server`) uses Express + SQLite. Run it with:

```bash
cd platform/examples/server
pnpm dev       # tsx watch — auto-restarts on changes
# or
pnpm start     # tsx — one-shot
```

Listens on **http://localhost:3001**.

### Endpoints

**`POST /api/interaction`**

Save a real-user interaction. The browser SDK calls this automatically.

```
Body: { app: string, ...Interaction }
```

The `app` field groups interactions by frontend app (e.g. `vanilla`, `react`, `nextjs`). Defaults to `'unknown'` if omitted.

```bash
curl -X POST http://localhost:3001/api/interaction \
  -H 'Content-Type: application/json' \
  -d '{"app":"vanilla","id":"abc123","type":"INITIAL_LOAD","status":"success",...}'
```

---

**`GET /api/interactions`**

List stored interactions with optional filters.

| Query param | Description | Default |
|---|---|---|
| `?app=vanilla` | Filter by app name | — |
| `?type=INITIAL_LOAD` | Filter by interaction type | — |
| `?status=fail` | Filter by status (`success`, `fail`, `timeout`, `cancel`) | — |
| `?uri=/products` | LIKE filter on URI path | — |
| `?limit=100` | Max rows returned | `100` |
| `?full=1` | Include full interaction JSON in each row | off |

```bash
# Last 10 failed loads in the vanilla app
curl "http://localhost:3001/api/interactions?app=vanilla&status=fail&limit=10"

# Full interaction JSON for all routes
curl "http://localhost:3001/api/interactions?full=1&limit=50"
```

---

**`GET /api/interaction/:id`**

Retrieve the full stored interaction JSON by interaction ID.

```bash
curl "http://localhost:3001/api/interaction/abc123"
```

---

**`PATCH /api/interaction/:id/trace`**

Enrich a stored interaction with CDP trace data (called automatically by `vitalsage capture`).

```
Body: { traceMetrics: TraceMetrics }
Response: { ok: true, id: string }
```

Merges `traceMetrics` into the interaction's `page` context so future `/api/audit` calls include flame-graph data.

---

### AI audit via SSE

**`GET /api/audit`** — streams analysis findings as Server-Sent Events. Results arrive per route as each completes, rather than waiting for all routes.

| Query param | Description | Default |
|---|---|---|
| `?app=vanilla` | App name to analyse (**required**) | — |
| `?minSamples=5` | Min interactions per route | `5` |
| `?route=/products` | Analyse a single route only | all routes |
| `?limit=500` | Max interactions to load | `500` |

**Event stream:**

```
event: start
data: {"app":"vanilla","interactions":243,"sessions":241,"routes":4,"ai":"anthropic"}

event: route
data: {"path":"/products","index":1,"total":4,"report":{...AnalysisReport...},"elapsed":1234}

event: route
data: {"path":"/","index":2,"total":4,"report":{...},"elapsed":2801}

event: done
data: {"routes":4,"suggestions":12,"elapsed":5432}
```

```bash
# Stream findings with curl
curl -N "http://localhost:3001/api/audit?app=vanilla&minSamples=1"

# Pretty-print each route report
curl -N "http://localhost:3001/api/audit?app=vanilla" | \
  while IFS= read -r line; do
    echo "$line" | grep '^data:' | cut -c7- | python3 -m json.tool 2>/dev/null
  done
```

**AI provider auto-detection** (checked in order at server startup):

```bash
ANTHROPIC_API_KEY=sk-ant-...   # → claude-sonnet-5
OPENAI_API_KEY=sk-...          # → gpt-4o
GEMINI_API_KEY=...             # → gemini-1.5-pro
```

---

## CLI — `vitalsage`

Install and link globally:

```bash
# One-time pnpm global setup (if not already done)
pnpm setup
source ~/.zshrc   # or open a new terminal

# Link the CLI
cd agent/cli
pnpm link --global

# Verify
vitalsage --help
```

### simulate

Run synthetic Playwright sessions across network and viewport profiles; save results as session JSON files for off-line analysis.

```bash
vitalsage simulate --url <url> [options]

  --url          Base URL to simulate (required)
  --runs         Runs per network/viewport combination  [default: 50]
  --routes       Additional routes (space-separated)    [default: /]
  --networks     Network profiles                       [default: 4g 3g slow-2g]
                 wifi | 4g | 3g | 2g | slow-2g
  --viewports    Viewport profiles                      [default: desktop mobile]
                 desktop | tablet | mobile
  --output       Output directory for session JSON      [default: ./vitalsage-data]
  --concurrency  Max parallel browser instances         [default: 3]
```

```bash
# Basic run
vitalsage simulate --url https://example.com

# Full matrix across 4 networks, 2 viewports, 3 routes
vitalsage simulate \
  --url https://example.com \
  --runs 10 \
  --networks wifi 4g 3g slow-2g \
  --viewports desktop mobile \
  --routes / /about /products \
  --output ./my-data
```

**Network profiles:**

| Profile | Throttle |
|---|---|
| `wifi` | None |
| `4g` | Emulated mobile 4G |
| `3g` | Emulated mobile 3G |
| `2g` | Emulated mobile 2G |
| `slow-2g` | Emulated slow 2G |

**Viewport profiles:**

| Profile | Size | DPR | Mobile emulation |
|---|---|---|---|
| `desktop` | 1280 × 800 | 1 | No |
| `tablet` | 768 × 1024 | 2 | Yes |
| `mobile` | 375 × 812 | 3 | Yes |

### analyze

Analyze a directory of session JSON files (or an HTTP endpoint) and print findings.

```bash
vitalsage analyze --sessions <dir> | --sessions-url <url> [options]

  --sessions        Directory of session JSON files
  --sessions-url    HTTP endpoint returning session JSON array
  --sessions-auth   Authorization header (e.g. "Bearer token")
  --min-samples     Min sessions per route                 [default: 50]
  --format          Output format                          [default: terminal]
                    terminal | html | json
  --output          Output file (required for html/json)
  --ai-provider     anthropic | openai | gemini
  --ai-key          API key for AI provider
  --ai-model        Model name override
```

```bash
# Terminal output from local sessions
vitalsage analyze --sessions ./vitalsage-data

# HTML report with AI suggestions
vitalsage analyze \
  --sessions ./vitalsage-data \
  --format html \
  --output report.html \
  --ai-provider anthropic \
  --ai-key $ANTHROPIC_API_KEY

# From a remote endpoint
vitalsage analyze \
  --sessions-url https://my-api.com/sessions \
  --sessions-auth "Bearer my-token" \
  --min-samples 10
```

### trace

Capture a live performance trace with Playwright and immediately analyze it. No server needed.

```bash
vitalsage trace --url <url> [options]

  --url          URL to trace (required)
  --runs         Trace runs to average                    [default: 3]
  --network      Network profile                          [default: 4g]
  --viewport     Viewport profile                         [default: desktop]
  --delay        Ms between runs                          [default: 2000]
  --full-report  Enable V8 CPU profiler for per-function flame chart
                 (~10–15% overhead, enables FunctionProfile data)
  --output       Save report (.html or .json)
  --ai-provider  anthropic | openai | gemini
  --ai-key       API key
  --ai-model     Model name override
```

```bash
# Quick terminal trace
vitalsage trace --url https://example.com

# Full flame chart + AI + HTML report
vitalsage trace \
  --url https://example.com \
  --runs 5 \
  --full-report \
  --output trace-report.html \
  --ai-provider anthropic \
  --ai-key $ANTHROPIC_API_KEY
```

Terminal output includes:
- Main thread breakdown: JS Execute, JS Compile, Rendering (with bar charts and colour coding)
- Total Blocking Time + long task count
- Flame chart: top functions by self time (`--full-report`) or top scripts by execution time
- Rule-based findings from all 9 agents
- AI-enhanced suggestions when `--ai-key` is provided

### capture

Enrich real-user interactions stored on the server with a CDP trace. Combines real CWV distributions (p75 from actual users) with trace data for deeper, more accurate analysis than synthetic-only runs.

```bash
vitalsage capture <url> [options]

  <url>          URL to capture (positional or --url)
  --server       VitalSage server URL                     [default: http://localhost:3001]
  --app          App name filter (optional — omit to match any app for the URL)
  --runs         Playwright trace runs to average        [default: 3]
  --network      Network profile                         [default: 4g]
  --viewport     Viewport profile                        [default: desktop]
  --full-report  V8 CPU profiler for per-function flame chart
  --no-server    Skip server fetch/patch — trace-only analysis
  --output       Save HTML/JSON report
  --ai-provider  anthropic | openai | gemini
  --ai-key       API key
  --ai-model     Model name override
```

```bash
# Enrich real sessions (any app) for a local dev server
vitalsage capture http://localhost:5173

# Specific app + full trace + AI analysis
vitalsage capture http://localhost:5173 \
  --app vanilla \
  --full-report \
  --ai-provider anthropic \
  --ai-key $ANTHROPIC_API_KEY \
  --output capture.html

# Trace only — no server required
vitalsage capture https://example.com --no-server --runs 5
```

**Flow:**
1. Fetches real-user interactions from the server (matched by URL path, optionally filtered by `--app`)
2. Runs Playwright trace capture and averages across `--runs`
3. Displays real-user p75 CWV (LCP, FCP, TTFB, CLS, INP) from actual sessions
4. Displays main-thread breakdown + flame chart from the live trace
5. Injects trace data into the most-recent real session; runs all 9 agents on the combined data
6. PATCHes the server so future `/api/audit` calls include the trace data
7. Saves HTML/JSON report if `--output` is provided

### report

Regenerate an HTML report from a previously saved analysis JSON file.

```bash
vitalsage report --input analysis.json --output report.html
```

### fix

Autonomous performance improvement loop. Measures → audits → generates AI-powered source file patches → verifies → retries until metrics improve or retries are exhausted.

**`--retries` is required with no default.** You must explicitly decide how many AI + measure cycles to allow, because each retry calls your AI provider and runs multiple Playwright sessions.

```bash
vitalsage fix --url <url> --source <dir> --retries <n> --ai-provider <provider> --ai-key <key> [options]

  --url          Page URL to audit and fix (required)
  --source       Path to your source directory — HTML/CSS/JS files to read and edit (required)
  --retries      Number of fix-and-verify cycles (REQUIRED, no default)
                 Each retry: calls the AI provider + runs Playwright measurements.
                 Recommended: 3–5 for typical issues, max 10 for complex pages.
  --ai-provider  AI provider: anthropic | openai | gemini (required)
  --ai-key       API key for the AI provider (required)
  --ai-model     Model name override (optional)
  --runs         Playwright runs per measurement pass   [default: 3]
  --network      Network profile: 4g | 3g              [default: 4g]
  --viewport     Viewport: desktop | mobile             [default: desktop]
```

```bash
vitalsage fix \
  --url http://localhost:5173 \
  --source ./src \
  --retries 5 \
  --ai-provider anthropic \
  --ai-key $ANTHROPIC_API_KEY
```

**What happens per attempt:**

| Step | What happens |
|------|-------------|
| **0** | Captures a baseline measurement before any changes |
| **1** | Runs all 9 agents on current sessions → identifies the top-priority issue |
| **2** | Opens a real Playwright browser → confirms the LCP element, blocking scripts, CLS sources |
| **3** | Reads your source files → AI generates precise search/replace patches → applies them |
| **4** | Re-measures the page and compares against the original baseline |
| **5** | If ≥ 3% improvement → done. Otherwise retries with updated context |

**Safety constraints:**
- AI failures and DOM inspection failures are non-fatal — the loop continues or exits cleanly
- Max 5 patches per AI response (hard cap in the parser)
- Source file reading is capped at 20 files / 25 KB per file to avoid token overflow
- Improvement threshold is 3% — synthetic measurement noise won't trigger a false "success"

---

## Analysis Engine — `vitalsage-analysis`

```typescript
import { AnalysisEngine, interactionsToSessions } from 'vitalsage-analysis';

// Convert real-user Interaction objects from the server into SessionReports
const sessions = interactionsToSessions(interactions);
// cancel-status interactions are dropped automatically

// Run analysis (waits for all routes to complete)
const engine  = new AnalysisEngine({ ai: { provider: 'anthropic', apiKey: '...' } });
const reports = await engine.analyze(sessions, { minSamples: 10 });

// Or stream results per route as they complete (better for SSE / progressive UI)
for await (const report of engine.analyzeStream(sessions, { minSamples: 5 })) {
  console.log(report.route.path, report.suggestions.length, 'suggestions');
}
```

**`EngineConfig`:**

```typescript
interface EngineConfig {
  ai?: {
    provider: 'anthropic' | 'openai' | 'gemini';
    apiKey:   string;
    model?:   string;  // overrides the default model for the provider
  };
  agents?:     'all' | string[];         // restrict to specific agent names; default: 'all'
  thresholds?: Partial<ThresholdConfig>; // override CWV thresholds
}
```

**`AnalysisOptions`:**

```typescript
interface AnalysisOptions {
  minSamples?:           number;  // min sessions per route; default: 50
  timeWindow?:           { from: number; to: number };
  includeRealOnly?:      boolean;
  includeSyntheticOnly?: boolean;
}
```

### Agents

Nine agents run in parallel per route. Each produces `Suggestion` objects with `severity`, `title`, `detail`, `estimatedImpact`, and `learnMore`.

Every agent runs in two phases:

1. **Rule-based `analyze()`** — fast, deterministic, zero cost. Checks specific thresholds against your real session data and produces data-driven suggestions with exact numbers (e.g. "p75 LCP is 4 200ms in 87% of sessions").
2. **AI `enhance()`** — when an AI provider is configured, each agent sends the full CWV distributions, device breakdowns, and page context (LCP element, scripts, fonts, images, navigation timing) to the AI and receives 1–3 deeper, cross-correlated suggestions that the rules cannot catch. AI failures are non-fatal — the agent silently falls back to rule-based output.

| Agent | Metric focus | Rule-based detections | AI enhancement focus |
|---|---|---|---|
| **lcp** | LCP | Missing `fetchpriority="high"`; cross-origin LCP without preload; mobile/desktop gap; TTFB masking LCP | Cross-correlates TTFB, resource hints, and image attributes for root-cause LCP diagnosis |
| **cls** | CLS | Unsized above-fold images; fonts without `font-display`; very high CLS | Identifies non-obvious shift sources from layout/font interactions |
| **inp** | INP | Mobile/desktop INP gap; synchronous third-party scripts in `<head>`; very poor INP | Diagnoses interaction latency from event handler patterns and third-party script timing |
| **ttfb** | TTFB | Slow server response (> 600ms); redirect chains; service worker overhead; high DNS time | Correlates navigation timing breakdown with infrastructure and caching opportunities |
| **image** | LCP, FCP | LCP image in legacy format (JPEG/PNG); oversized LCP image; above-fold images with `loading="lazy"` | Recommends format, sizing, and priority strategies specific to the LCP image |
| **font** | CLS, FCP | Fonts not preloaded; preloaded fonts missing `crossorigin`; fonts without `font-display` | Diagnoses FOIT/FOUT patterns and recommends font subsetting or swap strategies |
| **render-block** | FCP, LCP | Synchronous scripts in `<head>`; more than 3 render-blocking stylesheets | Identifies which specific blocking resources have the highest FCP impact |
| **resource-hint** | LCP, FCP | LCP image not preloaded; third-party origins without `preconnect` | Prioritises which origins and resources to hint based on the full resource waterfall |
| **trace** | TBT, LCP | Main-thread analysis — see table below | Cross-correlates CPU trace (scripting time, long tasks, hot scripts, hot functions) with CWV to give root-cause answers rather than generic threshold alerts |

### Metric thresholds

Follow Google CrUX definitions; overridable via `EngineConfig.thresholds`.

| Metric | Good | Poor |
|---|---|---|
| LCP    | ≤ 2500ms | > 4000ms |
| FCP    | ≤ 1800ms | > 3000ms |
| TTFB   | ≤ 800ms  | > 1800ms |
| CLS    | ≤ 0.1    | > 0.25   |
| INP    | ≤ 200ms  | > 500ms  |

### Trace agent thresholds

| Signal | Warning | Critical |
|---|---|---|
| Total Blocking Time | ≥ 300ms | ≥ 600ms |
| JS scripting time | ≥ 500ms | ≥ 1500ms |
| Forced layouts | ≥ 15 | ≥ 30 |
| Style recalculations | ≥ 50 | — |
| JS heap size | ≥ 100 MB | — |
| JS compile ratio | > 40% of scripting time | — |
| DOM nodes | ≥ 2500 | ≥ 5000 |
| JS event listeners | ≥ 500 | — |
| Rendering dominance | rendering > 60% of main-thread work AND scripting < 30% | — |
| Hot functions | self time > 50ms and share > 10% | share > 25% |

---

## Simulator — `vitalsage-simulator`

Used internally by `vitalsage trace` and `vitalsage simulate`. Can also be used as a library:

```typescript
import { PlaywrightSimulator } from 'vitalsage-simulator';

const simulator = new PlaywrightSimulator();
const sessions  = await simulator.simulate({
  url:              'https://example.com',
  runs:             10,
  outputDir:        './sessions',
  networks:         ['4g', '3g'],
  viewports:        ['desktop', 'mobile'],
  captureTrace:     true,   // V8 CPU Profiler via CDP Profiler domain
  captureFullTrace: false,  // per-function flame chart (~10–15% overhead)
  concurrency:      3,
  waitAfterLoad:    3000,   // ms after page load before collecting metrics
});
```

**Implementation notes:**
- Uses `Profiler.start/stop` (CDP Profiler domain) rather than `Tracing.*` — Playwright intercepts the Tracing domain for its own `context.tracing` feature, causing `Tracing.start` to silently no-op. The Profiler domain gives identical V8 CPU sample data.
- Sampling interval: `1000µs` when `captureFullTrace: true`; `5000µs` otherwise.
- Navigation: tries `networkidle` (30s timeout), falls back to `load` + `waitForLoadState('networkidle', { timeout: 5000 }).catch()` for sites with persistent XHR/WebSocket connections (e.g. booking sites, live dashboards).

---

## MCP Server — `vitalsage-mcp`

The MCP server exposes VitalSage's measurement and analysis capabilities as tools
that Claude Code (or any MCP-compatible AI agent) can call autonomously to
diagnose and fix real performance problems in your codebase.

### Setup

**1. Build the server:**
```bash
pnpm build
```

**2. Register with Claude Code:**

The repo ships with `.mcp.json` at the root — Claude Code, Cursor, and other MCP clients auto-discover this file:

```json
{
  "mcpServers": {
    "vitalsage": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/vitalsage/agent/mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

Or register it from the terminal using the `claude` CLI (use an absolute path):

```bash
claude mcp add --transport stdio --scope project vitalsage -- \
  node /absolute/path/to/vitalsage/agent/mcp/dist/index.js
```

Verify it's registered:
```bash
claude mcp list
# → vitalsage   stdio   node /absolute/path/...
```

**3. Restart Claude Code**, then confirm the 6 tools are available via `/mcp` in the chat panel.

**4. Tell Claude to debug your page:**
> "Audit http://localhost:3000/dashboard and fix whatever is hurting LCP the most."

Claude will autonomously loop: measure → analyze → grep your code → edit files → re-measure to verify the fix.

---

### Tools

| Tool | Description |
|------|-------------|
| `measure_page` | Synthetic Playwright run → CWV + optional TraceMetrics |
| `analyze_performance` | Run 9 analysis agents over sessions → ranked suggestions |
| `get_real_user_data` | Fetch real-user sessions from a running VitalSage server |
| `compare_performance` | Before/after diff — verify that a fix actually improved metrics |
| `audit_route` | Full end-to-end audit combining synthetic + real-user data |
| `find_element_in_dom` | DOM inspector: LCP element, blocking scripts, CLS sources |

#### `measure_page`

```
url           string   Page URL to measure (required)
runs          number   Number of synthetic runs (1–20, default 3)
networks      array    Network profiles: "wifi"|"4g"|"3g"|"2g"|"slow-2g" (default ["4g","3g"])
viewports     array    Viewport profiles: "desktop"|"mobile"|"tablet" (default ["desktop","mobile"])
captureTrace  boolean  Capture V8 CPU profile + DOM/JS heap metrics (default false)
routes        array    Additional route paths on the same origin
```

Returns: `{ sessions, summary[{ route, runCount, lcp_p75, cls_p75, inp_p75, ttfb_p75, fcp_p75 }], durationMs }`

#### `analyze_performance`

```
sessions      array    SessionReport[] from measure_page or get_real_user_data (required)
minSamples    number   Minimum sessions per route (default 1 — good for synthetic)
ai            object   { provider, apiKey, model? } — enables AI root-cause explanations
agents        array    Specific agents to run (omit for all 9)
```

Returns: `AnalysisReport[]` — one per route, with distributions, suggestions, confidence.

#### `get_real_user_data`

```
serverUrl     string   VitalSage server base URL (e.g. http://localhost:3001) (required)
app           string   Filter by app name
route         string   Filter by route path prefix
limit         number   Max sessions to return (default 500, max 10000)
since         number   Unix timestamp (ms) — only return sessions after this time
```

Returns: `{ sessions, total, routes[] }`

#### `compare_performance`

```
url           string   Page URL (required)
runs          number   Runs per pass (default 3)
networks      array    Network profiles
viewports     array    Viewport profiles
baseline      array    Pre-existing SessionReport[] — skip the first measurement pass
```

Returns: `{ diffs[{ metric, before, after, delta, deltasPct, improved }], summary, durationMs }`

Example summary:
```
3 metrics improved, 0 degraded.
LCP: 4200→2800 (-33%), CLS: 0.18→0.04 (-78%), INP: 340→210 (-38%)
```

#### `audit_route`

```
url           string   Route URL (required)
runs          number   Synthetic runs (default 5)
serverUrl     string   VitalSage server URL — fetch real-user sessions to merge
app           string   App name filter for real-user data
ai            object   AI provider config for enhanced suggestions
captureTrace  boolean  Capture CPU trace (default true)
```

Returns: `{ url, syntheticCount, realUserCount, analyses, topSuggestions[5], durationMs }`

#### `find_element_in_dom`

```
url           string   Page URL (required)
waitMs        number   Wait after load before snapshotting (500–15000ms, default 5000)
network       string   "wifi"|"4g"|"3g" (default "4g")
viewport      string   "desktop"|"mobile" (default "desktop")
```

Returns:
```typescript
{
  lcpElement: {
    tag, id, classes[], src, textPreview, width, height, isAboveFold
  } | null,
  blockingResources: [{ tag, src, reason }],
  clsContributors:   [{ selector, shift, rect }],
  imageLazyOpportunities: [{ src, width, height }],
  thirdPartyScripts: [{ src, origin, async, defer }],
}
```

---

### Autonomous debug loop

There are two ways to run the full fix loop:

#### Via Claude Code (MCP tools)

When you give Claude Code a performance goal, it follows this loop automatically using the MCP tools:

```
1. audit_route(url)
   → identify top issue (e.g. "LCP = 4.2s — render-blocking <script> in <head>")

2. find_element_in_dom(url)
   → confirm the LCP element and blocking script URLs

3. [Claude reads your source files, finds the <script> tags, removes async-less ones]

4. compare_performance(url, baseline=step1.sessions)
   → verify LCP improved

5. If not improved → analyze again, pick next suggestion, repeat
```

Claude Code has full access to your file system, so it can read component files, edit `<head>` templates, adjust webpack/vite configs, and then immediately re-measure to confirm the change worked — without you having to do anything manually.

#### Via CLI (`vitalsage fix`)

The same loop is available as a standalone CLI command that works without Claude Code:

```bash
vitalsage fix \
  --url http://localhost:5173 \
  --source ./src \
  --retries 5 \
  --ai-provider anthropic \
  --ai-key $ANTHROPIC_API_KEY
```

`--retries` is **required** (no default) to prevent unbounded AI spend. See the [fix](#fix) command reference for full details.

---

## Framework Integration Examples

### Vanilla JS / HTML

```html
<!-- Add to every page that should be tracked -->
<script type="module" src="./vitalsage-init.js"></script>
```

```javascript
// vitalsage-init.js
import { init, createLoggingAdapter, composeAdapters } from 'vitalsage';

const serverAdapter = {
  onInteraction: async (interaction) => {
    fetch('http://localhost:3001/api/interaction', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ app: 'my-app', ...interaction }),
    }).catch(() => {});
  },
};

export const instance = init({
  storage: {
    adapter: composeAdapters(
      createLoggingAdapter({ label: 'my-app' }),
      serverAdapter,
    ),
  },
});
```

### React

```typescript
// src/vitalsage-init.ts  (imported once from main.tsx before React mounts)
import { init, createLoggingAdapter, composeAdapters } from 'vitalsage';
import type { StorageAdapter } from 'vitalsage';

const serverAdapter: StorageAdapter = {
  onInteraction: async (interaction) => {
    await fetch('http://localhost:3001/api/interaction', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ app: 'react', ...interaction }),
    });
  },
};

init({
  storage: {
    adapter: composeAdapters(
      createLoggingAdapter({ label: 'react' }),
      serverAdapter,
    ),
  },
});
```

```tsx
// src/main.tsx
import './vitalsage-init';       // ← must come before React renders
import { StrictMode } from 'react';
import { createRoot }  from 'react-dom/client';
import App             from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

### Next.js

The SDK must only run in the browser. Use a client component with `useEffect`:

```typescript
// src/lib/vitalsage-init.ts
let initialised = false;

export async function bootVitalSage(): Promise<void> {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  // Dynamic import ensures the bundle is never loaded on the server
  const { init, createLoggingAdapter, composeAdapters } = await import('vitalsage');

  const serverAdapter = {
    onInteraction: async (interaction: unknown) => {
      await fetch('http://localhost:3001/api/interaction', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ app: 'nextjs', ...(interaction as object) }),
      });
    },
  };

  init({
    storage: {
      adapter: composeAdapters(
        createLoggingAdapter({ label: 'nextjs' }),
        serverAdapter,
      ),
    },
  });
}
```

```tsx
// src/components/VitalSageProvider.tsx
'use client';

import { useEffect }    from 'react';
import { bootVitalSage } from '../lib/vitalsage-init';

export default function VitalSageProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    bootVitalSage().catch(console.error);
  }, []);

  return <>{children}</>;
}
```

```tsx
// src/app/layout.tsx
import VitalSageProvider from '../components/VitalSageProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VitalSageProvider>
          {children}
        </VitalSageProvider>
      </body>
    </html>
  );
}
```

---

## Development

### Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9
- Playwright browsers: `pnpm exec playwright install chromium`

### Workspace commands

```bash
pnpm build      # build all packages (excludes examples)
pnpm test       # run all tests
pnpm typecheck  # type-check all packages
pnpm lint       # lint all packages
pnpm clean      # remove all build artifacts
```

### Running all examples together

```bash
# Terminal 1 — collection server (port 3001)
cd platform/examples/server && pnpm dev

# Terminal 2 — vanilla (port 5173)
cd platform/examples/vanilla && pnpm dev

# Terminal 3 — react (port 5174)
cd platform/examples/react && pnpm dev

# Terminal 4 — next.js (port 3002)
cd platform/examples/nextjs && pnpm dev
```

Each example posts to the same server. Filter by `?app=` when querying:

```bash
curl "http://localhost:3001/api/interactions?app=vanilla"
curl "http://localhost:3001/api/interactions?app=react"
curl "http://localhost:3001/api/interactions?app=nextjs"
```

### Package build order

Packages depend on each other — `pnpm build` at the root handles ordering automatically:

```
sdk/types  →  sdk/client          independent
sdk/types  →  agent/analysis      used by server + CLI + MCP
sdk/types  →  sdk/simulator       used by CLI + MCP
agent/analysis + sdk/simulator  →  agent/cli
agent/analysis + sdk/simulator  →  agent/mcp
```

### How bundles work

Both the CLI and MCP server use tsup with `noExternal` to inline workspace dependencies:

- **`agent/cli`** — bundles `vitalsage-analysis`, `vitalsage-simulator`, `@vitalsage/types` into `dist/index.cjs`. The global `vitalsage` binary is fully self-contained. Only `playwright` stays external.
- **`agent/mcp`** — same approach, bundles into `dist/index.js` (ESM). The MCP server runs as a single file with `node agent/mcp/dist/index.js`.
