import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Apply migrations/ to this test file's in-memory D1 before its tests run.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
