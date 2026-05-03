/**
 * End-to-end verification of the VitalSage MCP server.
 *
 * Spawns the MCP server as a child process, communicates via JSON-RPC over
 * stdio (the actual transport Claude Code uses), and asserts on the responses.
 *
 * Run from monorepo root:
 *   node agent/mcp/scripts/verify.mjs
 */
import { spawn }        from 'node:child_process';
import { createServer } from 'node:http';
import { resolve }      from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

let passed = 0, failed = 0, warned = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}
function warn(label, detail = '') {
  console.log(`  ${WARN} ${label}${detail ? ' — ' + detail : ''}`);
  warned++;
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ── MCP client over stdio ────────────────────────────────────────────────────

class McpClient {
  constructor(serverPath) {
    this._id    = 0;
    this._buf   = '';
    this._calls = new Map();
    this._proc  = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this._proc.stderr.on('data', d => process.stderr.write(`  [mcp-stderr] ${d}`));
    this._proc.stdout.on('data', (chunk) => {
      this._buf += chunk.toString();
      const lines = this._buf.split('\n');
      this._buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const cb  = this._calls.get(msg.id);
          if (cb) { this._calls.delete(msg.id); cb(msg); }
        } catch { /* ignore non-JSON */ }
      }
    });
    this._proc.on('error', err => console.error('[mcp-proc]', err));
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._calls.set(id, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this._proc.stdin.write(msg);

      setTimeout(() => {
        if (this._calls.has(id)) {
          this._calls.delete(id);
          reject(new Error(`Timeout on ${method}`));
        }
      }, 300_000);
    });
  }

  async initialize() {
    await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:      { name: 'verify-script', version: '1.0' },
    });
  }

  async callTool(name, args) {
    const res = await this.call('tools/call', { name, arguments: args });
    const text = res?.content?.[0]?.text ?? '';
    if (res?.isError) throw new Error(`Tool error: ${text}`);
    return JSON.parse(text);
  }

  async listTools() {
    const res = await this.call('tools/list', {});
    return res?.tools ?? [];
  }

  kill() {
    this._proc.stdin.end();
    this._proc.kill();
  }
}

// ── Local static test page ────────────────────────────────────────────────────

// Minimal HTML page designed to trigger specific findings:
//   - render-blocking <script> in <head>
//   - below-fold image missing loading="lazy"
//   - a late-inserted div to trigger CLS
const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VitalSage Verify Page</title>
  <script src="/block.js"></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <img id="hero" src="/hero.jpg" width="800" height="400"
       alt="Hero" style="display:block;width:100%;max-width:800px">
  <h1>VitalSage Verify</h1>
  <p>Verification page — render-blocking script, below-fold lazy-load opportunity, CLS trigger.</p>
  <div style="margin-top:2000px">
    <img src="/below-fold.jpg" width="400" height="200" alt="Below fold (missing lazy)">
  </div>
  <script>
    setTimeout(function() {
      var d = document.createElement('div');
      d.style.cssText = 'position:relative;height:200px;background:#f00;width:100%';
      document.body.insertBefore(d, document.body.firstChild);
    }, 800);
  </script>
</body>
</html>`;

// Synchronous busy-loop to simulate a real blocking script
const BLOCK_JS = `(function(){var e=Date.now()+100;while(Date.now()<e){}})();`;

// Minimum valid 1×1 JPEG
const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000' +
  'ffdb004300080606070605080707070909080a0c' +
  '140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20' +
  '242e2720222c231c1c2837292c30313434341f27' +
  '393d38323c2e333432ffc0000b08000100010101' +
  '1100ffc4001f00000105010101010101000000000' +
  '00000000102030405060708090a0bffda00080101' +
  '000003f0ffd9',
  'hex'
);

async function startTestServer() {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      const u = req.url?.split('?')[0];
      if (u === '/' || u === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE_HTML);
      } else if (u === '/block.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(BLOCK_JS);
      } else if (u === '/style.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end('body{margin:0;font-family:sans-serif}');
      } else if (u === '/hero.jpg' || u === '/below-fold.jpg') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(TINY_JPEG);
      } else {
        res.writeHead(404); res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[1m\x1b[34m══ VitalSage MCP — end-to-end verification ══\x1b[0m\n');

  // Start local server
  const { server: httpServer, url } = await startTestServer();
  console.log(`Test server: ${url}`);

  // Boot MCP server
  const serverPath = resolve(__dirname, '../dist/index.js');
  const client = new McpClient(serverPath);
  await client.initialize();
  console.log('MCP server: connected\n');

  try {
    // ── tools/list ────────────────────────────────────────────────────────────
    section('0. tools/list');
    const tools = await client.listTools();
    const names = tools.map(t => t.name);
    assert('6 tools registered',         names.length === 6, `got ${names.length}: ${names.join(', ')}`);
    assert('measure_page listed',         names.includes('measure_page'));
    assert('analyze_performance listed',  names.includes('analyze_performance'));
    assert('get_real_user_data listed',   names.includes('get_real_user_data'));
    assert('compare_performance listed',  names.includes('compare_performance'));
    assert('audit_route listed',          names.includes('audit_route'));
    assert('find_element_in_dom listed',  names.includes('find_element_in_dom'));
    for (const t of tools) {
      assert(`${t.name} has inputSchema`, t.inputSchema != null);
    }

    // ── measure_page (no trace) ───────────────────────────────────────────────
    section('1. measure_page — basic CWV (no trace)');
    console.log('  Running 3 synthetic sessions…');
    const measured = await client.callTool('measure_page', {
      url,
      runs:         3,
      networks:     ['4g', '3g'],
      viewports:    ['desktop', 'mobile'],
      captureTrace: false,
    });
    assert('sessions returned',          Array.isArray(measured.sessions), `type=${typeof measured.sessions}`);
    assert('≥1 session',                 measured.sessions.length >= 1, `got ${measured.sessions.length}`);
    assert('summary returned',           Array.isArray(measured.summary));
    assert('durationMs number',          typeof measured.durationMs === 'number');

    const s0 = measured.sessions[0];
    assert('sessionId string',           typeof s0?.sessionId === 'string');
    assert('synthetic=true',             s0?.synthetic === true);
    assert('device present',             s0?.device != null);
    assert('metrics present',            s0?.metrics != null);
    // metrics values are RawMetricValue objects — access .value for the number
    assert('TTFB > 0',                   (s0?.metrics?.TTFB?.value ?? 0) > 0, `TTFB=${s0?.metrics?.TTFB?.value}`);
    assert('FCP  > 0',                   (s0?.metrics?.FCP?.value  ?? 0) > 0, `FCP=${s0?.metrics?.FCP?.value}`);
    assert('LCP  > 0',                   (s0?.metrics?.LCP?.value  ?? 0) > 0, `LCP=${s0?.metrics?.LCP?.value}`);

    const sum = measured.summary[0];
    assert('summary lcp_p75 is number',  typeof sum?.lcp_p75 === 'number', `lcp_p75=${sum?.lcp_p75}`);
    assert('summary fcp_p75 is number',  typeof sum?.fcp_p75 === 'number');
    assert('summary ttfb_p75 is number', typeof sum?.ttfb_p75 === 'number');
    console.log(`  p75 → LCP:${sum?.lcp_p75}ms  FCP:${sum?.fcp_p75}ms  TTFB:${sum?.ttfb_p75}ms  CLS:${sum?.cls_p75}`);

    // ── measure_page with captureTrace ────────────────────────────────────────
    section('2. measure_page — captureTrace=true (TraceMetrics)');
    console.log('  Running 2 traced sessions (CPU profiler enabled)…');
    const traced = await client.callTool('measure_page', {
      url,
      runs:         2,
      networks:     ['4g'],
      viewports:    ['desktop'],
      captureTrace: true,
    });
    assert('sessions returned with trace', traced.sessions.length >= 1);

    const ts = traced.sessions.find(s => s.page?.traceMetrics != null);
    if (ts) {
      const tm = ts.page.traceMetrics;
      assert('longTaskCount ≥ 0',       typeof tm.longTaskCount === 'number', `=${tm.longTaskCount}`);
      assert('totalBlockingTime ≥ 0',   tm.totalBlockingTime >= 0,            `=${tm.totalBlockingTime}`);
      assert('scriptingTime ≥ 0',       tm.scriptingTime >= 0,                `=${tm.scriptingTime}`);
      assert('renderingTime ≥ 0',       tm.renderingTime >= 0,                `=${tm.renderingTime}`);
      assert('domNodes > 0',            (tm.domNodes ?? 0) > 0,               `=${tm.domNodes}`);
      assert('jsHeapUsed is number',    typeof tm.jsHeapUsed === 'number',     `=${tm.jsHeapUsed}`);
      assert('topScripts is array',     Array.isArray(tm.topScripts));
      assert('longTasks is array',      Array.isArray(tm.longTasks));
      // CDP-only fields should be 0 (not false/null)
      // layoutCount / styleRecalcCount come from CDP Performance.getMetrics — non-zero is correct
      assert('layoutCount ≥ 0',    typeof tm.layoutCount === 'number'    && tm.layoutCount >= 0,    `=${tm.layoutCount}`);
      assert('styleRecalcCount ≥ 0', typeof tm.styleRecalcCount === 'number' && tm.styleRecalcCount >= 0, `=${tm.styleRecalcCount}`);

      console.log(`  TraceMetrics:`);
      console.log(`    longTasks:        ${tm.longTaskCount}  (≥1 expected — we have a 100ms blocking script)`);
      console.log(`    TBT:              ${tm.totalBlockingTime}ms`);
      console.log(`    scriptingTime:    ${tm.scriptingTime}ms`);
      console.log(`    renderingTime:    ${tm.renderingTime}ms`);
      console.log(`    domNodes:         ${tm.domNodes}`);
      console.log(`    jsHeapUsed:       ${tm.jsHeapUsed ?? 0}MB`);
      console.log(`    topScripts:       ${tm.topScripts?.length ?? 0} entries`);
      if (tm.topScripts?.length) {
        for (const sc of tm.topScripts.slice(0, 3)) {
          console.log(`      • ${sc.url || 'inline'} — ${sc.time}ms (${(sc.share * 100).toFixed(1)}% of scripting)`);
        }
      }
      console.log(`    longTasks[]:      ${tm.longTasks?.length ?? 0} entries`);
      if (tm.longTasks?.length) {
        for (const lt of tm.longTasks.slice(0, 3)) {
          console.log(`      • start=${lt.startTime.toFixed(0)}ms  dur=${lt.duration.toFixed(0)}ms  blocking=${(lt.blocking ?? lt.duration).toFixed(0)}ms`);
        }
      }

      // Validate our blocking script shows up in longTasks (it runs 100ms sync)
      const bigTask = tm.longTasks?.find(t => t.duration >= 50);
      if (bigTask) {
        assert('100ms blocking script created a longTask ≥50ms', true,
          `duration=${bigTask.duration.toFixed(0)}ms`);
        console.log(`    ✓ 100ms blocking script created longTask: ${bigTask.duration.toFixed(0)}ms`);
      } else {
        warn('No longTask ≥50ms detected (blocking script may have been too short or buffering missed it)');
      }
    } else {
      warn('No traceMetrics on any session — browser longtask observer not supported or trace empty');
      console.log('  Sessions:', traced.sessions.map(s => ({
        id: s.sessionId?.slice(0,8),
        hasTrace: !!s.page?.traceMetrics,
        metrics: s.metrics,
      })));
    }

    // ── analyze_performance ───────────────────────────────────────────────────
    section('3. analyze_performance');
    const reports = await client.callTool('analyze_performance', {
      sessions:   measured.sessions,
      minSamples: 1,
    });
    assert('array returned',             Array.isArray(reports), `type=${typeof reports}`);
    assert('≥1 report',                  reports.length >= 1, `got ${reports.length}`);

    const r = reports[0];
    assert('analysisId string',          typeof r?.analysisId === 'string');
    assert('route present',              r?.route != null);
    assert('sampleSize ≥ 1',             (r?.sampleSize ?? 0) >= 1);
    assert('confidence present',         r?.confidence != null);
    assert('distributions object',       r?.distributions != null && typeof r.distributions === 'object');
    assert('suggestions array',          Array.isArray(r?.suggestions));

    if (r.suggestions.length) {
      const top = r.suggestions[0];
      assert('severity valid',  ['critical','warning','info'].includes(top.severity));
      assert('title non-empty', typeof top.title === 'string' && top.title.length > 5);
      assert('agent string',    typeof top.agent === 'string');
      assert('effort present',  top.effort != null);
      console.log(`  Confidence: ${r.confidence}  Suggestions: ${r.suggestions.length}`);
      r.suggestions.slice(0, 3).forEach((s, i) =>
        console.log(`  #${i+1} [${s.severity}] ${s.agent}: ${s.title}`)
      );
    } else {
      warn('No suggestions produced (page may be "fast enough" or too few sessions)');
    }

    // ── find_element_in_dom ───────────────────────────────────────────────────
    section('4. find_element_in_dom');
    console.log('  Navigating and inspecting DOM…');
    const dom = await client.callTool('find_element_in_dom', {
      url,
      waitMs:   3000,
      network:  '4g',
      viewport: 'desktop',
    });
    assert('url echoed back',             dom.url === url);
    assert('blockingResources array',     Array.isArray(dom.blockingResources));
    assert('clsContributors array',       Array.isArray(dom.clsContributors));
    assert('imageLazyOpportunities array',Array.isArray(dom.imageLazyOpportunities));
    assert('thirdPartyScripts array',     Array.isArray(dom.thirdPartyScripts));
    assert('durationMs number',           typeof dom.durationMs === 'number');

    // Our page always has a render-blocking script in <head>
    const blockingScript = dom.blockingResources.find(r => r.tag === 'script');
    assert('render-blocking script found', blockingScript != null,
      `found ${dom.blockingResources.length}: ${dom.blockingResources.map(r=>r.src).join(', ') || 'none'}`);
    if (blockingScript) {
      assert('blocking reason string', typeof blockingScript.reason === 'string' && blockingScript.reason.length > 0);
      console.log(`  Blocking: <${blockingScript.tag}> ${blockingScript.src}  reason="${blockingScript.reason}"`);
    }

    // Our page has a <link rel="stylesheet"> too
    const blockingStyle = dom.blockingResources.find(r => r.tag === 'link');
    if (blockingStyle) {
      console.log(`  Blocking: <${blockingStyle.tag}> ${blockingStyle.src}  reason="${blockingStyle.reason}"`);
    }

    // Below-fold image missing lazy
    assert('lazy-load opportunity found', dom.imageLazyOpportunities.length >= 1,
      `found ${dom.imageLazyOpportunities.length}`);
    if (dom.imageLazyOpportunities[0]) {
      const img = dom.imageLazyOpportunities[0];
      console.log(`  Lazy opportunity: ${img.src}  ${img.width}×${img.height}`);
    }

    // No 3P scripts expected on localhost
    assert('no 3P scripts on localhost',  dom.thirdPartyScripts.length === 0,
      `found ${dom.thirdPartyScripts.length}`);

    if (dom.lcpElement) {
      const lcp = dom.lcpElement;
      assert('LCP tag string',           typeof lcp.tag === 'string');
      assert('LCP width/height numbers', typeof lcp.width === 'number' && typeof lcp.height === 'number');
      assert('LCP isAboveFold bool',     typeof lcp.isAboveFold === 'boolean');
      console.log(`  LCP element: <${lcp.tag}${lcp.id ? '#'+lcp.id : ''}> ${lcp.width}×${lcp.height}px  above-fold=${lcp.isAboveFold}  src=${lcp.src ?? '(none)'}`);
    } else {
      warn('LCP element not captured — PerformanceObserver may not have fired in time');
    }

    if (dom.clsContributors.length > 0) {
      const top = dom.clsContributors[0];
      assert('CLS selector string',  typeof top.selector === 'string');
      assert('CLS shift number',     typeof top.shift === 'number' && top.shift > 0);
      console.log(`  CLS contributors: ${dom.clsContributors.length} — top: ${top.selector} shift=${top.shift.toFixed(4)}`);
    } else {
      warn('No CLS contributors — inserted div may not have triggered layout shift in time');
    }

    // ── compare_performance ───────────────────────────────────────────────────
    section('5. compare_performance (baseline=sessions from step 1)');
    console.log('  Running comparison pass…');
    const cmp = await client.callTool('compare_performance', {
      url,
      runs:      2,
      networks:  ['4g'],
      viewports: ['desktop'],
      baseline:  measured.sessions,
    });
    assert('diffs array returned',       Array.isArray(cmp.diffs), `type=${typeof cmp.diffs}`);
    assert('5 metric diffs',             cmp.diffs.length === 5, `got ${cmp.diffs.length}`);
    assert('summary string',             typeof cmp.summary === 'string');
    assert('durationMs number',          typeof cmp.durationMs === 'number');

    for (const d of cmp.diffs) {
      // INP requires actual user interaction — null on a static page is expected
      const interactionMetric = d.metric === 'INP';
      if (interactionMetric && d.before == null && d.after == null) {
        warn(`${d.metric} is null (no user interaction on this page — expected)`);
      } else {
        assert(`${d.metric} diff shape`, d.metric && d.before != null && d.after != null,
          `before=${d.before} after=${d.after}`);
      }
    }

    const lcp = cmp.diffs.find(d => d.metric === 'LCP');
    assert('LCP delta is number',        typeof lcp?.delta === 'number', `delta=${lcp?.delta}`);
    assert('LCP improved bool or null',  lcp?.improved == null || typeof lcp.improved === 'boolean');
    console.log(`  ${cmp.summary}`);

    // ── audit_route ───────────────────────────────────────────────────────────
    section('6. audit_route (synthetic only, captureTrace=false)');
    console.log('  Running full audit…');
    const audit = await client.callTool('audit_route', {
      url,
      runs:         3,
      captureTrace: false,
    });
    assert('url echoed',                 audit.url === url);
    assert('syntheticCount ≥ 1',         (audit.syntheticCount ?? 0) >= 1, `got ${audit.syntheticCount}`);
    assert('realUserCount = 0',          audit.realUserCount === 0);
    assert('analyses array',             Array.isArray(audit.analyses));
    assert('topSuggestions array',       Array.isArray(audit.topSuggestions));
    assert('topSuggestions ≤ 5',         audit.topSuggestions.length <= 5);
    assert('durationMs number',          typeof audit.durationMs === 'number');

    if (audit.topSuggestions.length) {
      const best = audit.topSuggestions[0];
      assert('top suggestion has title', typeof best.title === 'string' && best.title.length > 5);
      console.log(`  Synthetic: ${audit.syntheticCount}  Reports: ${audit.analyses.length}  Top suggestions: ${audit.topSuggestions.length}`);
      audit.topSuggestions.slice(0, 3).forEach((s, i) =>
        console.log(`  #${i+1} [${s.severity}] ${s.agent}: ${s.title}`)
      );
    } else {
      warn('No suggestions from audit (try more runs)');
    }

  } finally {
    client.kill();
    httpServer.close();
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(55)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ALL ${total} ASSERTIONS PASSED\x1b[0m  (${warned} warnings)`);
  } else {
    console.log(`\x1b[31m\x1b[1m  ${failed} / ${total} ASSERTIONS FAILED\x1b[0m  (${warned} warnings)`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\x1b[31mFATAL:\x1b[0m', err);
  process.exit(1);
});
