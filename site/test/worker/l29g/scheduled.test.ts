// L29g: the Worker's weekly scheduled() handler runs all four retention jobs,
// each logs a count only, and one failing job never stops the other three.
// Real D1 with every migration applied; a failure is simulated by a DB wrapper
// that refuses statements for one table. Fixtures use example.org only.
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../../../worker/index";

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const OLD = ago(200 * 24 * HOUR); // past every limit: 180, 90 and 1 days
const RECENT = ago(HOUR); // inside every limit

const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? -1;

interface Job {
  name: string;
  /** A table only this job's statements name, so the failing wrapper hits this job alone. */
  table: string;
  log: RegExp;
  seed: () => Promise<unknown>;
  /** The old rows were deleted or cleared. */
  done: () => Promise<boolean>;
  /** The recent rows are untouched. */
  kept: () => Promise<boolean>;
}

const JOBS: Job[] = [
  {
    name: "resourcus purge",
    table: "ask_logs",
    log: /^resourcus purge: \d+ ask_logs, \d+ ask_sessions$/,
    seed: () =>
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO ask_logs (created_at, caller, question, mode, reason) VALUES (?, 'web', 'old', 'fallback', 'test'), (?, 'web', 'recent', 'fallback', 'test')",
        ).bind(OLD, RECENT),
        env.DB.prepare("INSERT INTO ask_sessions (session_hash, verified_at) VALUES ('old', ?), ('recent', ?)").bind(OLD, RECENT),
      ]),
    done: async () =>
      (await count("SELECT COUNT(*) AS n FROM ask_logs WHERE question = 'old'")) === 0 &&
      (await count("SELECT COUNT(*) AS n FROM ask_sessions WHERE session_hash = 'old'")) === 0,
    kept: async () =>
      (await count("SELECT COUNT(*) AS n FROM ask_logs WHERE question = 'recent'")) === 1 &&
      (await count("SELECT COUNT(*) AS n FROM ask_sessions WHERE session_hash = 'recent'")) === 1,
  },
  {
    name: "applications sweep",
    table: "applications",
    log: /^applications sweep: \d+ declined and cleared$/,
    seed: () =>
      env.DB.prepare(
        "INSERT INTO applications (created_at, status, role, name, email, based_in, why, badges, consent_at) VALUES (?, 'new', 'fusion-canyon-connector', 'Old', 'sweep@example.org', 'Greeley', 'why', '{}', ?), (?, 'new', 'fusion-canyon-connector', 'Recent', 'sweep@example.org', 'Greeley', 'why', '{}', ?)",
      )
        .bind(OLD, OLD, RECENT, RECENT)
        .run(),
    done: async () =>
      (await count(`SELECT COUNT(*) AS n FROM applications WHERE created_at = '${OLD}' AND status = 'declined' AND email IS NULL`)) === 1,
    kept: async () => (await count("SELECT COUNT(*) AS n FROM applications WHERE name = 'Recent' AND status = 'new'")) === 1,
  },
  {
    name: "nominations sweep",
    table: "nominations",
    log: /^nominations sweep: \d+ cleared$/,
    seed: () =>
      env.DB.prepare("INSERT INTO nominations (created_at, status, payload) VALUES (?, 'new', ?), (?, 'new', ?)")
        .bind(OLD, '{"legal_name":"Old","contact_email":"sweep@example.org"}', RECENT, '{"legal_name":"Recent","contact_email":"sweep@example.org"}')
        .run(),
    done: async () =>
      (await count(
        "SELECT COUNT(*) AS n FROM nominations WHERE json_extract(payload,'$.legal_name') = 'Old' AND json_extract(payload,'$.contact_email') IS NULL AND financials_deleted_at IS NOT NULL",
      )) === 1,
    kept: async () =>
      (await count(
        "SELECT COUNT(*) AS n FROM nominations WHERE json_extract(payload,'$.legal_name') = 'Recent' AND json_extract(payload,'$.contact_email') = 'sweep@example.org' AND financials_deleted_at IS NULL",
      )) === 1,
  },
  {
    name: "csp_reports purge",
    table: "csp_reports",
    log: /^csp_reports purge: \d+ deleted$/,
    seed: () =>
      env.DB.prepare(
        "INSERT INTO csp_reports (signature, directive, blocked_uri, document_uri, count, first_seen, last_seen) VALUES ('old', 'img-src', 'https://x.example', '/', 1, ?, ?), ('recent', 'img-src', 'https://x.example', '/', 1, ?, ?)",
      )
        .bind(OLD, OLD, OLD, RECENT)
        .run(),
    done: async () => (await count("SELECT COUNT(*) AS n FROM csp_reports WHERE signature = 'old'")) === 0,
    kept: async () => (await count("SELECT COUNT(*) AS n FROM csp_reports WHERE signature = 'recent'")) === 1,
  },
];

/** env.DB, except that any statement naming `table` throws, the way a D1 outage would. */
function failingOn(table: string): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes(table)) throw new Error(`${table} unavailable`);
      return env.DB.prepare(sql);
    },
    batch: (statements: D1PreparedStatement[]) => env.DB.batch(statements),
    exec: (sql: string) => env.DB.exec(sql),
  } as unknown as D1Database;
}

async function runScheduled(db: D1Database = env.DB) {
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ cron: "17 9 * * 1" }), { ...env, DB: db }, ctx);
  await waitOnExecutionContext(ctx);
}

const lines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((args) => args.map(String).join(" "));

describe("the weekly scheduled() handler", () => {
  beforeEach(async () => {
    for (const table of ["ask_logs", "ask_sessions", "applications", "nominations", "csp_reports"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    for (const job of JOBS) await job.seed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs all four jobs: each clears its old rows and keeps its recent ones", async () => {
    await runScheduled();
    for (const job of JOBS) {
      expect(await job.done(), `${job.name} cleared old rows`).toBe(true);
      expect(await job.kept(), `${job.name} kept recent rows`).toBe(true);
    }
  });

  it("logs one line per job, with a count and nothing else", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    await runScheduled();
    const logged = lines(log);
    for (const job of JOBS) {
      expect(logged.filter((l) => job.log.test(l)), job.name).toHaveLength(1);
    }
    expect(logged).toHaveLength(JOBS.length);
    expect(logged.join("\n")).not.toContain("example.org");
    expect(lines(error)).toEqual([]);
  });

  it.each(JOBS.map((job) => [job.name, job] as const))("keeps running the other jobs when the %s fails", async (_name, failing) => {
    const error = vi.spyOn(console, "error");
    await runScheduled(failingOn(failing.table));

    expect(await failing.done(), `${failing.name} did not run`).toBe(false);
    for (const job of JOBS.filter((j) => j !== failing)) {
      expect(await job.done(), `${job.name} still ran`).toBe(true);
      expect(await job.kept(), `${job.name} kept recent rows`).toBe(true);
    }
    expect(lines(error)).toEqual([`${failing.name} failed: ${failing.table} unavailable`]);
  });
});
