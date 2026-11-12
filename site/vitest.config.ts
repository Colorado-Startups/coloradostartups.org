import { mkdirSync } from "node:fs";
import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Three projects, ported from the sibling site:
//   - worker: runs INSIDE workerd through the Cloudflare pool. D1 is real and
//     in-memory, the migrations apply per file, outbound fetches go through MSW.
//   - unit: pure functions in plain Node.
//   - dom: assertions over the built dist/ HTML (needs `npm run build` first).
//
// Lane test files live under test/<project>/<lane>/ so lanes never edit the
// same test file. The MSW handler index (test/worker/msw.ts) is
// orchestrator-owned; lanes add handler files and import them in their tests.
export default defineConfig(async () => {
  // wrangler.jsonc points assets at ./dist. Miniflare needs the directory to
  // exist even before a build; real builds overwrite it. The worker tests
  // override it with an empty fixture folder (below), so a real build in dist/
  // never changes what they see (L3 found rpc tests failing after a build).
  mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              // Workers AI and AI Search are remote-only. Tests never need real
              // inference or search: they inject fakes, so the suite stays
              // hermetic and runs in CI without Cloudflare credentials.
              remoteBindings: false,
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                assets: { directory: path.join(__dirname, "test/fixtures/assets"), binding: "ASSETS" },
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  TURNSTILE_SECRET_KEY: "test-secret",
                  KIT_API_KEY: "test-kit-key",
                  KIT_FORM_ID: "1234",
                  // Only tests may answer from the 20 fictional fixture cards;
                  // production with no resources.json answers with no cards.
                  RESOURCUS_ALLOW_FIXTURE: "1",
                },
                // Calls this same Worker's named entrypoint, the way the
                // Communitas Worker does in production.
                serviceBindings: {
                  RESOURCUS_SELF: { name: "coloradostartups-site", entrypoint: "ResourcusRPC" },
                },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/worker/**/*.test.ts"],
            setupFiles: ["./test/worker/apply-migrations.ts", "./test/worker/msw.ts"],
          },
        },
        {
          test: {
            name: "unit",
            environment: "node",
            include: ["test/unit/**/*.test.ts"],
          },
        },
        {
          test: {
            name: "dom",
            environment: "jsdom",
            include: ["test/dom/**/*.test.ts"],
            setupFiles: ["./test/dom/setup.ts"],
          },
        },
      ],
    },
  };
});
