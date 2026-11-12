// GET /api/health: the uptime probe. Through the real router against the real
// in-memory D1, then the handler alone with a D1 that fails or hangs.

import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSP_HEADER_NAME, CSP_VALUE } from "../../worker/lib/security-headers";
import { DB_TIMEOUT_MS, handle } from "../../worker/routes/health";

const URL_HEALTH = "https://coloradostartups.org/api/health";

// A D1 stand-in that records every statement it is asked to prepare.
function fakeDb(first: () => Promise<unknown>): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const db = {
    prepare(query: string) {
      sql.push(query);
      return { first };
    },
  } as unknown as D1Database;
  return { db, sql };
}

const envWith = (db: D1Database) => ({ DB: db }) as unknown as Env;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers 200 with D1 ok, no-store and the security headers", async () => {
    const res = await SELF.fetch(URL_HEALTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get(CSP_HEADER_NAME)).toBe(CSP_VALUE);
  });

  it("answers HEAD with the same status and no body", async () => {
    const res = await SELF.fetch(URL_HEALTH, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("refuses POST with 405 and names GET and HEAD", async () => {
    const res = await SELF.fetch(URL_HEALTH, { method: "POST", body: "{}" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("runs one read and nothing else", async () => {
    const { db, sql } = fakeDb(async () => ({ 1: 1 }));
    const res = await handle(new Request(URL_HEALTH), envWith(db));
    expect(res.status).toBe(200);
    expect(sql).toEqual(["SELECT 1"]);
  });

  it("answers 503 when D1 throws, without the error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(async () => {
      throw new Error("D1_ERROR: secret-looking detail");
    });
    const res = await handle(new Request(URL_HEALTH), envWith(db));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", db: "down" });
    expect(text).not.toContain("secret-looking");
  });

  it("answers 503 once D1 hangs past the timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    const { db } = fakeDb(() => new Promise(() => {}));
    const pending = handle(new Request(URL_HEALTH), envWith(db));
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(DB_TIMEOUT_MS).toBeLessThan(1500);
  });
});
