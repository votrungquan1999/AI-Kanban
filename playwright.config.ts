import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * The Next dev server is started MANUALLY (not managed by Playwright), so the
 * suite runs against an already-running server. In one terminal:
 *   npm run dev:e2e        # next dev on :3001 against the ai_kanban_e2e DB
 * then in another: `npm run test:e2e`.
 * Override the target with E2E_BASE_URL if needed.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
