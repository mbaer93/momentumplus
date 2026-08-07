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
  // `next start` always sets NODE_ENV=production, and the deployed-and-
  // unconfigured guard (middleware + getAdminAccess) 503s on that combination
  // by design. This says "the missing credentials are deliberate" so the
  // preview build the suite tests actually serves pages.
  ALLOW_UNCONFIGURED_PREVIEW: "1",
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
    //
    // PLAYWRIGHT_SKIP_BUILD lets CI run `npm run build` as its OWN step and
    // start only the server here. That matters because this timeout is a
    // SERVER-READINESS deadline, and folding a full production build into it
    // means the deadline shrinks every time the app grows — which is exactly
    // how CI started failing with "Timed out waiting from config.webServer"
    // while the build was still healthy and mid-compile. Locally the default
    // still builds, so `npx playwright test` works from a clean checkout.
    command: process.env.PLAYWRIGHT_SKIP_BUILD
      ? "npm run start"
      : "npm run build && npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    // Generous either way: Playwright proceeds the moment the URL answers, so
    // headroom costs nothing on a fast run and only moves the failure line.
    timeout: process.env.PLAYWRIGHT_SKIP_BUILD ? 120_000 : 600_000,
    env: previewEnv,
  },
});
