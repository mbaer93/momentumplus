import { defineConfig } from "@playwright/test";

/*
 * Critical-flow e2e tests (CLAUDE.md testing expectations). Runs against the
 * production build in preview mode (no external credentials needed).
 *
 * PLAYWRIGHT_CHROMIUM_PATH lets constrained environments point at a
 * preinstalled Chromium instead of downloading one.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
