import { defineConfig } from '@playwright/test';

//
// Playwright end-to-end runner configuration.
//
// ── Isolation from Vitest (important) ─────────────────────────────────────────
// Unit tests in this repo run under Vitest and are named ".test.ts".
// Playwright's default discovery globs (the ".spec.ts" and ".test.ts" patterns)
// would otherwise try to execute those Vitest files and fail. Scoping testDir +
// testMatch to "tests/e2e" and ".e2e.ts" keeps the two runners completely
// separate — Playwright only ever sees ".e2e.ts" files.
//
// ── Scope ─────────────────────────────────────────────────────────────────────
// This configures the "@playwright/test" runner only. The performance simulator
// (sdk/simulator) uses the "playwright" library directly and is unaffected by
// this file.
//
// ── Portability ───────────────────────────────────────────────────────────────
// Tests run on Playwright's bundled Chromium (installed via
// "pnpm exec playwright install chromium"), not a system-installed browser.
// The bundled browser is self-contained and identical across machines, so
// results don't depend on the host OS having a particular Chrome/Edge version.
//
export default defineConfig({
  testDir:   './tests/e2e',
  testMatch: /.*\.e2e\.ts$/,

  fullyParallel: true,
  forbidOnly:    !!process.env['CI'],
  retries:       process.env['CI'] ? 2 : 0,
  reporter:      'list',

  use: {
    headless: true,
    trace:    'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',            // bundled Chromium — no system-browser channel
        viewport:    { width: 1280, height: 720 },
      },
    },
  ],
});
