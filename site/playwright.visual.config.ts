import { defineConfig, devices } from "@playwright/test";

// Visual check: full-page Chromium screenshots of chosen routes at chosen
// widths, for the advisory visual-check workflow. It renders on a
// GitHub-hosted runner, never on this Mac (Paul, 2026-11-02). The spec in
// test/visual/ reads VISUAL_PATHS and VISUAL_WIDTHS and writes one PNG per pair to
// test-results/visual-shots/, which the workflow uploads as an artifact.
//
// Like playwright.config.ts it builds the site, then serves dist/ with
// scripts/serve-dist.mjs on 127.0.0.1 (that file says why not astro preview).
// It has a port of its own, so a visual run and an e2e run never test each
// other's server.
const PORT = Number(process.env.VISUAL_PORT ?? 3304);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./test/visual",
  outputDir: "./test-results/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && node scripts/serve-dist.mjs --port ${PORT} --host ${HOST}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
