# VitalSage Examples

Three testing apps (vanilla, React, Next.js) plus a shared Express server.
Each app exercises the same five scenarios so you can compare SDK behaviour
across rendering strategies.

## Quick Start

```bash
# 1. Install all dependencies from the monorepo root
pnpm install

# 2. Build the client SDK (needed by all three apps)
pnpm --filter @vitalsage/client build

# 3. Start the shared server (port 3001)
cd examples/server && pnpm dev

# 4a. Vanilla (port 5173)
cd examples/vanilla && pnpm dev

# 4b. React / Vite (port 5174)
cd examples/react && pnpm dev

# 4c. Next.js (port 3002)
cd examples/nextjs && pnpm dev
```

Open `http://localhost:3001/api/sessions` to query the SQLite database.
Filter by app: `?app=vanilla`, `?app=react`, `?app=nextjs`.
Fetch one full session: `GET /api/session/:id`.

---

## Test Scenarios

| Page | URL | What it tests |
|------|-----|---------------|
| Home | `/` | Initial load, static content, LCP from hero text |
| About | `/about` | Navigation — metrics reset per page |
| Products | `/products` | Async fetch + spinner → late LCP, CLS from spinner swap |
| Gallery | `/gallery` | Image LCP, CLS comparison (sized vs unsized images) |
| Heavy | `/heavy` | Long tasks, TBT, INP from CPU-blocking work |

---

## What to Verify Manually

1. **Debug panel** (bottom-right) updates as each metric fires.
2. **Console** — `[VitalSage] session →` logs after you navigate away or close the tab.
3. **IndexedDB** — Application → IndexedDB → vitalsage → sessions.
4. **Express server** — `GET http://localhost:3001/api/sessions` returns rows from SQLite.
   Filter by app: `?app=vanilla`, `?app=react`, `?app=nextjs`.
5. **Metric values make sense:**
   - `LCP` on Products is higher than on Home (content loads late).
   - `LCP` on Gallery is driven by the largest image.
   - `CLS` on Gallery/Unsized tab is noticeably higher than Sized tab.
   - `TBT` on Heavy is elevated (two 200 ms blocking tasks on load).
