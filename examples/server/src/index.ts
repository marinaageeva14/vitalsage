import express   from 'express';
import cors      from 'cors';
import Database  from 'better-sqlite3';
import { join }  from 'node:path';
import { mkdir } from 'node:fs/promises';

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
app.get('/api/interactions', (req, res) => {
  const { app: appFilter, type, status, limit = '100' } = req.query as Record<string, string>;

  let sql = 'SELECT iid, app, type, status, uri, referrer, timestamp, duration, lcp, fcp, ttfb, cls, inp, device FROM interactions';
  const where:  string[]  = [];
  const params: unknown[] = [];

  if (appFilter) { where.push('app = ?');    params.push(appFilter); }
  if (type)      { where.push('type = ?');   params.push(type); }
  if (status)    { where.push('status = ?'); params.push(status); }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Number(limit));

  type Row = {
    iid: string; app: string; type: string; status: string;
    uri: string | null; referrer: string | null;
    timestamp: number | null; duration: number | null;
    lcp: number | null; fcp: number | null; ttfb: number | null;
    cls: number | null; inp: number | null; device: string | null;
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
  })));
});

// ── GET /api/interaction/:id ────────────────────────────────────────
app.get('/api/interaction/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM interactions WHERE iid = ?').get(req.params.id) as { data: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(JSON.parse(row.data));
});

// ── Start ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] database: ${join(DATA_DIR, 'vitalsage.db')}`);
  console.log(`[server] endpoints:`);
  console.log(`         POST /api/interaction        – save an interaction`);
  console.log(`         GET  /api/interactions       – list (?app=vanilla&type=INITIAL_LOAD&status=fail)`);
  console.log(`         GET  /api/interaction/:id    – full interaction JSON`);
});
