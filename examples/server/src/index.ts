import express   from 'express';
import cors      from 'cors';
import Database  from 'better-sqlite3';
import { join }  from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Interaction } from '@vitalsage/types';
import type { EngineConfig } from 'vitalsage-analysis';
import { AnalysisEngine, interactionsToSessions } from 'vitalsage-analysis';

// ── AI provider auto-detection ──────────────────────────────────────
// Read API keys from environment at startup so we don't log them per-request.
function detectAiConfig(): EngineConfig['ai'] | undefined {
  if (process.env['ANTHROPIC_API_KEY']) {
    return { provider: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] };
  }
  if (process.env['OPENAI_API_KEY']) {
    return { provider: 'openai', apiKey: process.env['OPENAI_API_KEY'] };
  }
  if (process.env['GEMINI_API_KEY']) {
    return { provider: 'gemini', apiKey: process.env['GEMINI_API_KEY'] };
  }
  return undefined;
}

const AI_CONFIG = detectAiConfig();

const app  = express();
const PORT = 3001;

// ── SQLite setup ────────────────────────────────────────────────────
const DATA_DIR = new URL('../data/', import.meta.url).pathname;
await mkdir(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'vitalsage.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS interactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    iid         TEXT    NOT NULL UNIQUE,
    app         TEXT    NOT NULL DEFAULT 'unknown',
    type        TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    uri         TEXT,
    referrer    TEXT,
    timestamp   INTEGER,
    duration    INTEGER,
    lcp         REAL,
    fcp         REAL,
    ttfb        REAL,
    cls         REAL,
    inp         REAL,
    device      TEXT,
    data        TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_interactions_app       ON interactions(app);
  CREATE INDEX IF NOT EXISTS idx_interactions_type      ON interactions(type);
  CREATE INDEX IF NOT EXISTS idx_interactions_status    ON interactions(status);
  CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp DESC);
`);

const upsertInteraction = db.prepare(`
  INSERT INTO interactions (iid, app, type, status, uri, referrer, timestamp, duration, lcp, fcp, ttfb, cls, inp, device, data)
  VALUES (@iid, @app, @type, @status, @uri, @referrer, @timestamp, @duration, @lcp, @fcp, @ttfb, @cls, @inp, @device, @data)
  ON CONFLICT(iid) DO UPDATE SET
    app       = excluded.app,
    type      = excluded.type,
    status    = excluded.status,
    uri       = excluded.uri,
    referrer  = excluded.referrer,
    timestamp = excluded.timestamp,
    duration  = excluded.duration,
    lcp       = excluded.lcp,
    fcp       = excluded.fcp,
    ttfb      = excluded.ttfb,
    cls       = excluded.cls,
    inp       = excluded.inp,
    device    = excluded.device,
    data      = excluded.data
`);

// ── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── POST /api/interaction ───────────────────────────────────────────
// Body: { app: 'vanilla' | 'react' | 'nextjs', ...Interaction }
app.post('/api/interaction', (req, res) => {
  try {
    const { app: appName = 'unknown', ...interaction } = req.body as Record<string, unknown> & { app?: string };

    if (!interaction?.id) {
      res.status(400).json({ error: 'Missing interaction id' });
      return;
    }

    const metrics = interaction.metrics as Record<string, { value?: number }> | undefined;
    const uri     = (interaction.uri as string | undefined) ?? null;
    const path    = uri ? (() => { try { return new URL(uri).pathname; } catch { return uri; } })() : '?';

    upsertInteraction.run({
      iid:       interaction.id,
      app:       appName,
      type:      interaction.type,
      status:    interaction.status,
      uri,
      referrer:  (interaction.referrer as string | undefined) ?? null,
      timestamp: (interaction.timestamp as number | undefined) ?? null,
      duration:  (interaction.duration as number | undefined) ?? null,
      lcp:       metrics?.LCP?.value  ?? null,
      fcp:       metrics?.FCP?.value  ?? null,
      ttfb:      metrics?.TTFB?.value ?? null,
      cls:       metrics?.CLS?.value  ?? null,
      inp:       metrics?.INP?.value  ?? null,
      device:    (interaction.device as { deviceCategory?: string } | undefined)?.deviceCategory ?? null,
      data:      JSON.stringify(interaction),
    });

    const lcp  = metrics?.LCP?.value;
    const type = String(interaction.type);
    console.log(
      `[server] ${type.padEnd(13)}  app=${String(appName).padEnd(8)}  ` +
      `status=${String(interaction.status).padEnd(8)}  ` +
      `${path}  ` +
      (lcp != null ? `LCP=${Math.round(lcp)}ms  ` : '') +
      `dur=${interaction.duration}ms`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[server] error saving interaction:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/interactions ───────────────────────────────────────────
// Query params: ?app=vanilla  ?type=INITIAL_LOAD  ?status=fail  ?limit=100
//               ?uri=https://...  ?full=1 (include full interaction JSON)
app.get('/api/interactions', (req, res) => {
  const { app: appFilter, type, status, uri, limit = '100', full } = req.query as Record<string, string>;

  const cols = full === '1'
    ? 'iid, app, type, status, uri, referrer, timestamp, duration, lcp, fcp, ttfb, cls, inp, device, data'
    : 'iid, app, type, status, uri, referrer, timestamp, duration, lcp, fcp, ttfb, cls, inp, device';

  let sql = `SELECT ${cols} FROM interactions`;
  const where:  string[]  = [];
  const params: unknown[] = [];

  if (appFilter) { where.push('app = ?');      params.push(appFilter); }
  if (type)      { where.push('type = ?');     params.push(type); }
  if (status)    { where.push('status = ?');   params.push(status); }
  if (uri)       { where.push('uri LIKE ?');   params.push(`%${uri}%`); }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Number(limit));

  type Row = {
    iid: string; app: string; type: string; status: string;
    uri: string | null; referrer: string | null;
    timestamp: number | null; duration: number | null;
    lcp: number | null; fcp: number | null; ttfb: number | null;
    cls: number | null; inp: number | null; device: string | null;
    data?: string;
  };

  const rows = db.prepare(sql).all(...params) as Row[];

  res.json(rows.map(r => ({
    id:        r.iid,
    app:       r.app,
    type:      r.type,
    status:    r.status,
    uri:       r.uri,
    referrer:  r.referrer,
    timestamp: r.timestamp,
    duration:  r.duration,
    LCP:       r.lcp  != null ? Math.round(r.lcp)  : null,
    FCP:       r.fcp  != null ? Math.round(r.fcp)  : null,
    TTFB:      r.ttfb != null ? Math.round(r.ttfb) : null,
    CLS:       r.cls  != null ? r.cls.toFixed(3)   : null,
    INP:       r.inp  != null ? Math.round(r.inp)  : null,
    device:    r.device,
    ...(r.data ? { interaction: JSON.parse(r.data) as Interaction } : {}),
  })));
});

// ── GET /api/interaction/:id ────────────────────────────────────────
app.get('/api/interaction/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM interactions WHERE iid = ?').get(req.params.id) as { data: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(JSON.parse(row.data));
});

// ── PATCH /api/interaction/:id/trace ───────────────────────────────
// Enriches a stored interaction with CDP trace data captured by
// `vitalsage capture`. Merges traceMetrics into the interaction's page
// context so future /api/audit calls include the flame-graph data.
//
// Body: { traceMetrics: TraceMetrics }
app.patch('/api/interaction/:id/trace', (req, res) => {
  const row = db.prepare('SELECT data FROM interactions WHERE iid = ?')
    .get(req.params.id) as { data: string } | undefined;

  if (!row) { res.status(404).json({ error: 'Interaction not found' }); return; }

  try {
    const interaction = JSON.parse(row.data) as Interaction & { page?: Record<string, unknown> };
    const { traceMetrics } = req.body as { traceMetrics: unknown };

    if (!traceMetrics || typeof traceMetrics !== 'object') {
      res.status(400).json({ error: 'Body must be { traceMetrics: TraceMetrics }' });
      return;
    }

    // Merge trace data into the stored page context
    const enriched = {
      ...interaction,
      page: {
        ...(interaction.page ?? {}),
        traceMetrics,
      },
    };

    db.prepare('UPDATE interactions SET data = ? WHERE iid = ?')
      .run(JSON.stringify(enriched), req.params.id);

    console.log(`[server] PATCH trace  iid=${req.params.id}`);
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error('[server] /api/interaction/:id/trace error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/audit ──────────────────────────────────────────────────
// Runs the analysis engine against real-user interactions and streams
// findings back via Server-Sent Events (SSE) as each route is analysed.
//
// AI enhancement is automatically enabled when an API key env var is set:
//   ANTHROPIC_API_KEY   → claude-sonnet-4-20250514
//   OPENAI_API_KEY      → gpt-4o
//   GEMINI_API_KEY      → gemini-1.5-pro
//
// Query params:
//   ?app=vanilla          app name to filter by (required)
//   ?minSamples=5         min interactions per route (default: 5)
//   ?route=/products      analyse a single route only (optional)
//   ?limit=500            max interactions to load (default: 500)
//
// SSE event stream:
//   event: start   data: { app, interactions, sessions, routes, ai }
//   event: route   data: { path, index, total, report: AnalysisReport, elapsed }
//   event: error   data: { path, message }          (non-fatal — stream continues)
//   event: done    data: { routes, suggestions, elapsed }
app.get('/api/audit', async (req, res) => {
  const {
    app:        appFilter,
    minSamples: minSamplesStr = '5',
    route:      routeFilter,
    limit:      limitStr = '500',
  } = req.query as Record<string, string>;

  if (!appFilter) {
    res.status(400).json({ error: 'Missing required query param: ?app=' });
    return;
  }

  // ── SSE headers ───────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const startTime = Date.now();

  try {
    // ── Load interactions ──────────────────────────────────────────
    let sql = `SELECT data FROM interactions WHERE app = ? AND status IN ('success','timeout','fail')`;
    const params: unknown[] = [appFilter];

    if (routeFilter) {
      sql += ` AND uri LIKE ?`;
      params.push(`%${routeFilter}`);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(Number(limitStr));

    const rows         = db.prepare(sql).all(...params) as { data: string }[];
    const interactions = rows.map(r => JSON.parse(r.data) as Interaction);
    const sessions     = interactionsToSessions(interactions);

    if (sessions.length === 0) {
      send('error', { message: 'No usable interactions found — visit the app first to generate data.' });
      res.end();
      return;
    }

    // Compute route list upfront so the client knows total count.
    const routeSet = new Set(sessions.map(s => s.route.path));

    send('start', {
      app:          appFilter,
      interactions: interactions.length,
      sessions:     sessions.length,
      routes:       routeSet.size,
      ai:           AI_CONFIG ? AI_CONFIG.provider : null,
    });

    console.log(
      `[server] /api/audit  app=${appFilter}  interactions=${interactions.length}` +
      `  sessions=${sessions.length}  routes=${routeSet.size}` +
      `  ai=${AI_CONFIG?.provider ?? 'none'}`
    );

    // ── Stream analysis ────────────────────────────────────────────
    const engine     = new AnalysisEngine({ ...(AI_CONFIG ? { ai: AI_CONFIG } : {}) });
    const minSamples = Math.max(1, Number(minSamplesStr));
    const routes     = Array.from(routeSet);
    let   routesDone = 0;
    let   totalSugs  = 0;

    for await (const report of engine.analyzeStream(sessions, { minSamples })) {
      routesDone++;
      totalSugs += report.suggestions.length;
      send('route', {
        path:    report.route.path,
        index:   routesDone,
        total:   routes.length,
        report,
        elapsed: Date.now() - startTime,
      });
    }

    send('done', {
      routes:      routesDone,
      suggestions: totalSugs,
      elapsed:     Date.now() - startTime,
    });

    console.log(
      `[server] /api/audit done  routes=${routesDone}  suggestions=${totalSugs}` +
      `  elapsed=${Date.now() - startTime}ms`
    );
  } catch (err) {
    console.error('[server] /api/audit error:', err);
    send('error', { message: String(err) });
  } finally {
    res.end();
  }
});

// ── Start ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] database: ${join(DATA_DIR, 'vitalsage.db')}`);
  console.log(`[server] endpoints:`);
  console.log(`         POST /api/interaction        – save an interaction`);
  console.log(`         GET  /api/interactions       – list (?app=vanilla&type=INITIAL_LOAD&status=fail)`);
  console.log(`         GET  /api/interaction/:id       – full interaction JSON`);
  console.log(`         PATCH /api/interaction/:id/trace – enrich with CDP trace data`);
  console.log(`         GET  /api/audit?app=vanilla     – SSE: stream analysis findings (AI: ${AI_CONFIG ? AI_CONFIG.provider : 'disabled — set ANTHROPIC_API_KEY to enable'})`);
  if (!AI_CONFIG) {
    console.log(`[server] tip: export ANTHROPIC_API_KEY=sk-ant-... before starting for AI-enhanced analysis`);
  }
});
