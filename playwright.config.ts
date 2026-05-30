import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * The Next dev server is started MANUALLY (not managed by Playwright), so the
 * suite runs against an already-running server. Before `npm run test:e2e`:
 *   MONGODB_DB=ai_kanban_e2e npm run dev   # throwaway DB, avoids dev data
 * then in another terminal: `npm run test:e2e`.
 * Override the target with E2E_BASE_URL if not on :3000.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
