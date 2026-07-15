import { defineConfig } from "@playwright/test";

/*
 * Critical-flow e2e tests (CLAUDE.md testing expectations). The suite runs
 * against a build in PREVIEW mode (no credentials): the webServer builds and
 * serves with the Supabase env forced empty so a developer's .env.local
 * (which Next would otherwise load) can't flip the app into configured mode.
 *
 * PLAYWRIGHT_CHROMIUM_PATH lets constrained environments point at a
 * preinstalled Chromium instead of downloading one.
 */
const previewEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  NEXT_PUBLIC_STREAM_API_KEY: "",
  STREAM_API_SECRET: "",
};

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
    // Build + serve in preview env. Process env beats .env.local in Next, so
    // the empty strings above pin preview mode for both build and runtime.
    command: "npm run build && npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 240_000,
    env: previewEnv,
  },
});
