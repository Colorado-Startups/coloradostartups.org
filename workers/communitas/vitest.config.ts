import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Communitas runs inside workerd. The RESOURCUS service binding points at the
// site Worker, which does not exist in this pool, so tests replace it with a
// stub. L5's answer tests inject a fake Resourcus at the function boundary.
export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SLACK_SIGNING_SECRET: "test-signing-secret",
          SLACK_BOT_TOKEN: "xoxb-test",
          USER_KEY_SALT: "test-salt",
        },
        serviceBindings: {
          RESOURCUS: () => new Response("stub", { status: 200 }),
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // Blocks every non-loopback fetch and fails the test that made it (#660).
    setupFiles: ["./test/net-guard-setup.ts"],
  },
});
