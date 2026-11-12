import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { capsFromEnv, D1Budget } from "../../../worker/resourcus/budget";
import { purgeResourcusData } from "../../../worker/resourcus/logs";
import { isSessionVerified, markSessionVerified } from "../../../worker/resourcus/session";

const OCT = new Date("2026-10-15T12:00:00Z");
const NOV = new Date("2026-11-01T00:00:01Z");

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_counters"),
    env.DB.prepare("DELETE FROM ask_logs"),
    env.DB.prepare("DELETE FROM ask_sessions"),
  ]);
});

const count = (counter: string, period: string) =>
  env.DB.prepare("SELECT count FROM usage_counters WHERE counter = ? AND period = ?")
    .bind(counter, period)
    .first<number>("count");

describe("D1Budget", () => {
  it("grants units up to the cap, then refuses, and never counts past the cap", async () => {
    const budget = new D1Budget(env.DB, { model_calls: 3, search_queries: 1 }, () => OCT);
    const grants = [];
    for (let i = 0; i < 5; i++) grants.push(await budget.reserve("model_calls"));
    expect(grants).toEqual([true, true, true, false, false]);
    expect(await count("model_calls", "2026-10")).toBe(3);
  });

  it("keeps the two counters apart", async () => {
    const budget = new D1Budget(env.DB, { model_calls: 5, search_queries: 1 }, () => OCT);
    expect(await budget.reserve("search_queries")).toBe(true);
    expect(await budget.reserve("search_queries")).toBe(false);
    expect(await budget.reserve("model_calls")).toBe(true);
  });

  it("refuses a reservation larger than what is left", async () => {
    const budget = new D1Budget(env.DB, { model_calls: 3, search_queries: 1 }, () => OCT);
    expect(await budget.reserve("model_calls", 2)).toBe(true);
    expect(await budget.reserve("model_calls", 2)).toBe(false);
    expect(await budget.reserve("model_calls", 1)).toBe(true);
  });

  it("starts fresh each calendar month", async () => {
    let now = OCT;
    const budget = new D1Budget(env.DB, { model_calls: 1, search_queries: 1 }, () => now);
    expect(await budget.reserve("model_calls")).toBe(true);
    expect(await budget.reserve("model_calls")).toBe(false);
    now = NOV;
    expect(await budget.reserve("model_calls")).toBe(true);
  });

  it("holds under concurrent questions", async () => {
    const budget = new D1Budget(env.DB, { model_calls: 4, search_queries: 1 }, () => OCT);
    const grants = await Promise.all(Array.from({ length: 10 }, () => budget.reserve("model_calls")));
    expect(grants.filter(Boolean)).toHaveLength(4);
    expect(await count("model_calls", "2026-10")).toBe(4);
  });

  it("fails closed: zero cap, no database, or a database error", async () => {
    expect(await new D1Budget(env.DB, { model_calls: 0, search_queries: 0 }).reserve("model_calls")).toBe(false);
    expect(await new D1Budget(undefined, { model_calls: 9, search_queries: 9 }).reserve("model_calls")).toBe(false);
    const broken = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;
    expect(await new D1Budget(broken, { model_calls: 9, search_queries: 9 }).reserve("model_calls")).toBe(false);
  });

  it("reads both caps from wrangler vars", () => {
    expect(capsFromEnv(env)).toEqual({ model_calls: 1800, search_queries: 900 });
  });
});

describe("Turnstile sessions", () => {
  const id = "0f8c2a6e-5b1d-4e3a-9c7f-2d4b6a8e0c1f";

  it("remembers a verified session for a day, by hash only", async () => {
    expect(await isSessionVerified(env.DB, id, OCT)).toBe(false);
    await markSessionVerified(env.DB, id, OCT);
    expect(await isSessionVerified(env.DB, id, new Date(OCT.getTime() + 23 * 3_600_000))).toBe(true);
    expect(await isSessionVerified(env.DB, id, new Date(OCT.getTime() + 25 * 3_600_000))).toBe(false);
    const row = await env.DB.prepare("SELECT session_hash FROM ask_sessions").first<string>("session_hash");
    expect(row).toMatch(/^[0-9a-f]{64}$/);
    expect(row).not.toBe(id);
  });

  it("never treats a short id as a session", async () => {
    await markSessionVerified(env.DB, "short", OCT);
    expect(await isSessionVerified(env.DB, "short", OCT)).toBe(false);
  });
});

describe("purgeResourcusData", () => {
  it("deletes ask_logs past 90 days and sessions past one day, and keeps the rest", async () => {
    const now = new Date("2026-12-31T00:00:00Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const log = env.DB.prepare(
      "INSERT INTO ask_logs (created_at, caller, question, mode, reason) VALUES (?, 'web', 'q', 'model', 'ok')",
    );
    const session = env.DB.prepare("INSERT INTO ask_sessions (session_hash, verified_at) VALUES (?, ?)");
    await env.DB.batch([
      log.bind(daysAgo(91)),
      log.bind(daysAgo(89)),
      session.bind("old", daysAgo(2)),
      session.bind("new", daysAgo(0.5)),
    ]);
    expect(await purgeResourcusData(env.DB, now)).toEqual({ logs: 1, sessions: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ask_logs").first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT session_hash FROM ask_sessions").first("session_hash")).toBe("new");
  });
});
