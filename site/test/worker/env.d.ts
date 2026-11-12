// Test-only bindings declared in vitest.config.ts. Everything else on
// Cloudflare.Env comes from the generated worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    RESOURCUS_SELF: Service<import("../../worker/rpc").ResourcusRPC>;
  }
}
