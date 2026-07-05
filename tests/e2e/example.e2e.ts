import { test, expect } from '@playwright/test';

/**
 * Starter end-to-end test.
 *
 * Named `*.e2e.ts` so the Playwright runner picks it up while Vitest (which
 * only matches `*.test.ts`) ignores it entirely — the two suites never collide.
 *
 * This one is self-contained (no dev server needed) so `pnpm test:e2e` passes
 * out of the box. To test the real apps end to end, add a `webServer` block to
 * playwright.config.ts that boots an example (e.g. platform/examples/vanilla)
 * and navigate to it here.
 */
test('smoke — Playwright runner is wired up and isolated from Vitest', async ({ page }) => {
  await page.setContent('<main><h1>VitalSage</h1></main>');
  await expect(page.locator('h1')).toHaveText('VitalSage');
});
