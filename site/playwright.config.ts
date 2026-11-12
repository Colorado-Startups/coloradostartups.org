import { defineConfig, devices } from "@playwright/test";

// E2E. Scope: client journeys + error states + deep a11y, against the built
// static site served out of dist/. The form POST contract is covered by the
// Worker integration tests, so these specs never submit and need no Turnstile,
// D1, or email. The advisory e2e workflow runs it in shards on every PR whose
// site inputs changed, and the cloud-test workflow runs it on demand. Nothing
// runs it on this Mac (Paul, 2026-11-02).
//
// 127.0.0.1, not localhost, on purpose. `localhost` resolves to both ::1 and
// 127.0.0.1, and the two are separate listening sockets: a server bound to one
// is invisible on the other. That mismatch is what made `reuseExistingServer`
// skip a preview server that was demonstrably live. Pinning both the server and
// the baseURL to one literal address removes the ambiguity, so reuse works
// whether or not a server is already up.
//
// The webServer command is scripts/serve-dist.mjs rather than `astro preview`
// because Astro 7.3 detaches the preview server into the background whenever it
// detects an AI agent is driving the terminal, and Playwright requires the
// command to stay in the foreground. See the header of that script.
// E2E_PORT lets lanes run e2e side by side without testing each other's build.
const PORT = Number(process.env.E2E_PORT ?? 3302);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build the static site, then serve dist/ in the foreground.
    command: `npm run build && node scripts/serve-dist.mjs --port ${PORT} --host ${HOST}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // The build is the slow half (fonts, sharp, Pagefind); the serve
    // step is instant.
    timeout: 180_000,
  },
});
