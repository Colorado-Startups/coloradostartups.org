import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { anonId } from "../../worker/lib/anon-id";
import {
  cleanProps,
  EVENT_MAX_BYTES,
  EVENT_NAMES,
  EVENT_PROPS,
  handle,
  POSTHOG_CAPTURE_URL,
  REFUSED_LOG,
  REFUSED_LOG_EVERY_MS,
  resetRefusedLog,
} from "../../worker/routes/e";
import { server } from "./server";

const ORIGIN = "https://coloradostartups.org";
const URL_ = `${ORIGIN}/api/e`;
const IP = "198.51.100.7";
const UA = "Mozilla/5.0 (test)";
const DAY1 = new Date("2026-11-15T12:00:00Z");

// The secrets the route needs, as test values. The real ones are set with
// `wrangler secret put` and never appear in the repo.
const configured = {
  ...env,
  POSTHOG_PROJECT_TOKEN: "phc_test_token",
  ANON_ID_SALT: "test-salt",
} as unknown as Env;

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      Origin: ORIGIN,
      "Content-Type": "text/plain",
      "CF-Connecting-IP": IP,
      "User-Agent": UA,
      Cookie: "session=abc; ph_x=1",
      Referer: `${ORIGIN}/join/?email=a@b.example`,
      "X-Forwarded-For": IP,
      ...headers,
    },
  });
}

// Mocks PostHog's capture endpoint and keeps each forwarded request.
function capture(): { headers: Headers; body: Record<string, unknown> }[] {
  const seen: { headers: Headers; body: Record<string, unknown> }[] = [];
  server.use(
    http.post(POSTHOG_CAPTURE_URL, async ({ request }) => {
      seen.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ status: "Ok" });
    }),
  );
  return seen;
}

beforeEach(() => {
  resetRefusedLog();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// A stand-in for the Worker's ExecutionContext that keeps each waitUntil promise.
function fakeCtx(): { ctx: ExecutionContext; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
  return { ctx: ctx as unknown as ExecutionContext, pending };
}

// Silences console.error for one test and hands back the spy to assert on.
function errors() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

// Each console.error call as the one line it prints.
function lines(spy: ReturnType<typeof errors>): string[] {
  return spy.mock.calls.map((c) => c.map(String).join(" "));
}

describe("POST /api/e", () => {
  it("is wired in the route table and refuses GET", async () => {
    const res = await SELF.fetch(URL_, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("answers 400 for a name off the allow-list, and forwards nothing", async () => {
    const seen = capture();
    errors();
    for (const body of [{ name: "page_view" }, { name: "" }, { props: {} }, "{not json", "[]"]) {
      const res = await handle(post(body), configured, undefined, DAY1);
      expect(res.status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it("logs one fixed line for a refused name, with no payload, at most once a minute", async () => {
    const log = errors();
    await handle(post({ name: "join_clik", props: { where: "home" } }), configured, undefined, DAY1);
    expect(lines(log)).toEqual(["/api/e: refused event name"]);
    expect(REFUSED_LOG).toBe("/api/e: refused event name");
    for (const value of ["join_clik", "home", IP, UA]) expect(lines(log)[0]).not.toContain(value);

    // A second refusal inside the minute stays quiet; the next minute logs again.
    await handle(post({ name: "page_view" }), configured, undefined, new Date(DAY1.getTime() + 1000));
    expect(lines(log)).toHaveLength(1);
    await handle(post({ name: "page_view" }), configured, undefined, new Date(DAY1.getTime() + REFUSED_LOG_EVERY_MS));
    expect(lines(log)).toEqual([REFUSED_LOG, REFUSED_LOG]);
  });

  it("logs nothing for a body that is not an event at all", async () => {
    const log = errors();
    for (const body of [{ props: {} }, "{not json", "[]", { name: 7 }]) {
      expect((await handle(post(body), configured, undefined, DAY1)).status).toBe(400);
    }
    expect(lines(log)).toEqual([]);
  });

  it("answers 400 to an oversize body, logs nothing and forwards nothing", async () => {
    const seen = capture();
    const log = errors();
    const big = JSON.stringify({ name: "join_click", props: { where: "home" }, pad: "x".repeat(EVENT_MAX_BYTES) });
    expect(big.length).toBeGreaterThan(EVENT_MAX_BYTES);
    expect((await handle(post(big), configured, undefined, DAY1)).status).toBe(400);
    // The same body as a stream with no Content-Length, so only the read cap stops it.
    const streamed = new Request(URL_, {
      method: "POST",
      body: new Blob([big]).stream(),
      headers: { Origin: ORIGIN, "Content-Type": "text/plain", "CF-Connecting-IP": IP },
      duplex: "half",
    } as RequestInit);
    expect((await handle(streamed, configured, undefined, DAY1)).status).toBe(400);
    expect(seen).toHaveLength(0);
    expect(lines(log)).toEqual([]);
  });

  it("answers 204 before PostHog does, and forwards inside waitUntil", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: unknown[] = [];
    server.use(
      http.post(POSTHOG_CAPTURE_URL, async ({ request }) => {
        await gate;
        seen.push(await request.json());
        return HttpResponse.json({ status: "Ok" });
      }),
    );
    const { ctx, pending } = fakeCtx();
    const res = await handle(post({ name: "join_click", props: { where: "home" } }), configured, ctx, DAY1);
    expect(res.status).toBe(204);
    expect(pending).toHaveLength(1);
    expect(seen).toHaveLength(0);
    release();
    await Promise.all(pending);
    expect(seen).toHaveLength(1);
  });

  it("cancels the PostHog reply body it never reads, ok or not", async () => {
    for (const status of [200, 500]) {
      let cancelled = false;
      const body = new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("x"));
        },
        cancel() {
          cancelled = true;
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body, { status }));
      const log = errors();
      const res = await handle(post({ name: "step_done" }), configured, undefined, DAY1);
      expect(res.status).toBe(204);
      expect(cancelled).toBe(true);
      expect(lines(log)).toEqual(status === 200 ? [] : ["/api/e: PostHog answered 500"]);
      vi.restoreAllMocks();
    }
  });

  it("answers 429 when the limiter refuses, before PostHog is called", async () => {
    const seen = capture();
    const limited = { ...configured, EVENT_RATE_LIMIT: { limit: async () => ({ success: false }) } } as unknown as Env;
    const res = await handle(post({ name: "join_click" }), limited, undefined, DAY1);
    expect(res.status).toBe(429);
    expect(seen).toHaveLength(0);
  });

  it("answers 403 to another origin or no origin", async () => {
    const seen = capture();
    expect((await handle(post({ name: "join_click" }, { Origin: "https://evil.example" }), configured)).status).toBe(403);
    const noOrigin = post({ name: "join_click" });
    noOrigin.headers.delete("Origin");
    expect((await handle(noOrigin, configured)).status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("answers 503, names the missing secret and forwards nothing when a secret is not set", async () => {
    const seen = capture();
    const log = errors();
    const res = await handle(post({ name: "join_click" }), env as unknown as Env, undefined, DAY1);
    expect(res.status).toBe(503);
    expect(lines(log)).toEqual(["/api/e: secret not set: POSTHOG_PROJECT_TOKEN, ANON_ID_SALT; event dropped"]);

    log.mockClear();
    const noSalt = { ...configured, ANON_ID_SALT: undefined } as unknown as Env;
    expect((await handle(post({ name: "join_click" }), noSalt, undefined, DAY1)).status).toBe(503);
    expect(lines(log)).toEqual(["/api/e: secret not set: ANON_ID_SALT; event dropped"]);
    expect(lines(log).join("\n")).not.toContain("phc_test_token");
    expect(seen).toHaveLength(0);
  });

  it("logs and drops the event when CF-Connecting-IP is missing, so visitors never merge into one id", async () => {
    const seen = capture();
    const log = errors();
    const req = post({ name: "join_click" });
    req.headers.delete("CF-Connecting-IP");
    const res = await handle(req, configured, undefined, DAY1);
    expect(res.status).toBe(204);
    expect(seen).toHaveLength(0);
    expect(lines(log)).toEqual(["/api/e: no CF-Connecting-IP; event dropped"]);
    expect(lines(log).join("\n")).not.toContain(UA);
  });

  it("forwards one anonymous event with no IP, cookie or visitor header", async () => {
    const seen = capture();
    const res = await handle(
      post({ name: "door_pick", props: { door: "founder", where: "home", $ip: IP, $set: { email: "a@b.example" }, n: 2 } }),
      configured,
      undefined,
      DAY1,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(seen).toHaveLength(1);

    const { headers, body } = seen[0];
    for (const h of ["Cookie", "CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP", "Referer", "User-Agent"]) {
      expect(headers.get(h) ?? "").not.toContain(IP);
    }
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("Referer")).toBeNull();
    expect(headers.get("User-Agent")).not.toBe(UA);

    expect(body.event).toBe("door_pick");
    expect(body.api_key).toBe("phc_test_token");
    expect(body.distinct_id).toBe(await anonId("test-salt", IP, UA, DAY1));
    expect(body.properties).toEqual({ where: "home", door: "founder", $process_person_profile: false, $geoip_disable: true });
    expect(body).not.toHaveProperty("$ip");
    expect(JSON.stringify(body)).not.toContain(IP);
    expect(JSON.stringify(body)).not.toContain("session=abc");
    expect(JSON.stringify(body)).not.toContain(UA);
  });

  it("still answers 204 and logs the status when PostHog answers 5xx or 4xx", async () => {
    for (const status of [500, 400, 401]) {
      server.use(http.post(POSTHOG_CAPTURE_URL, () => new HttpResponse(null, { status })));
      const log = errors();
      const res = await handle(post({ name: "step_done" }), configured, undefined, DAY1);
      expect(res.status).toBe(204);
      expect(lines(log)).toEqual([`/api/e: PostHog answered ${status}`]);
      log.mockRestore();
    }
  });

  it("still answers 204 and logs when the fetch to PostHog is rejected", async () => {
    server.use(http.post(POSTHOG_CAPTURE_URL, () => HttpResponse.error()));
    const log = errors();
    const res = await handle(post({ name: "step_done" }), configured, undefined, DAY1);
    expect(res.status).toBe(204);
    expect(lines(log)).toHaveLength(1);
    expect(lines(log)[0]).toMatch(/^\/api\/e: forward failed: \S/);
    for (const value of [IP, UA, "session=abc"]) expect(lines(log)[0]).not.toContain(value);
  });

  it("gives up on a PostHog that never answers, then answers 204 and logs", async () => {
    // The route asks for a 3 s timeout; the test shortens it to 5 ms and hands
    // back a fetch that settles only when that signal aborts.
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const asked = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(5));
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error("no signal"));
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const log = errors();
    const res = await handle(post({ name: "step_done" }), configured, undefined, DAY1);
    expect(res.status).toBe(204);
    expect(asked).toHaveBeenCalledWith(3000);
    expect(lines(log)).toHaveLength(1);
    expect(lines(log)[0]).toMatch(/^\/api\/e: forward failed: \S/);
    for (const value of [IP, UA, "session=abc"]) expect(lines(log)[0]).not.toContain(value);
  });
});

describe("anonId", () => {
  it("is stable within a UTC day and changes the next day", async () => {
    const morning = await anonId("s", IP, UA, new Date("2026-11-15T00:00:01Z"));
    const night = await anonId("s", IP, UA, new Date("2026-11-15T23:59:59Z"));
    const next = await anonId("s", IP, UA, new Date("2026-11-16T00:00:01Z"));
    expect(morning).toMatch(/^[0-9a-f]{32}$/);
    expect(night).toBe(morning);
    expect(next).not.toBe(morning);
  });

  it("depends on the salt, the IP and the User-Agent, and never contains the IP", async () => {
    const base = await anonId("s", IP, UA, DAY1);
    expect(await anonId("t", IP, UA, DAY1)).not.toBe(base);
    expect(await anonId("s", "203.0.113.9", UA, DAY1)).not.toBe(base);
    expect(await anonId("s", IP, "other", DAY1)).not.toBe(base);
    expect(base).not.toContain(IP);
  });

  it("gives the forwarded event a new id on a new day", async () => {
    const seen = capture();
    await handle(post({ name: "join_click" }), configured, undefined, DAY1);
    await handle(post({ name: "join_click" }), configured, undefined, new Date("2026-11-16T12:00:00Z"));
    expect(seen).toHaveLength(2);
    expect(seen[0].body.distinct_id).not.toBe(seen[1].body.distinct_id);
  });
});

describe("cleanProps", () => {
  it("lists one or two keys for exactly the 12 event names", () => {
    expect(EVENT_NAMES).toHaveLength(12);
    for (const name of EVENT_NAMES) {
      expect(EVENT_PROPS[name].length).toBeGreaterThan(0);
      expect(EVENT_PROPS[name].length).toBeLessThanOrEqual(2);
    }
  });

  it("keeps only the keys the event lists", () => {
    expect(cleanProps("door_pick", { door: "founder", where: "home", region: "front-range", other: "x" })).toEqual({
      door: "founder",
      where: "home",
    });
    expect(cleanProps("join_click", { door: "founder" })).toEqual({});
    expect(cleanProps("search_used", { where: "nav", results: 3, query: "my-co" })).toEqual({ where: "nav", results: 3 });
  });

  it("keeps short slugs, finite numbers and booleans, and drops every other value", () => {
    expect(cleanProps("join_submit", { where: "join-form_2", ok: true })).toEqual({ where: "join-form_2", ok: true });
    expect(cleanProps("search_used", { results: 0 })).toEqual({ results: 0 });
    for (const bad of [
      "a@b.example",
      "Founder",
      "two words",
      "https://x.example/",
      "x".repeat(41),
      "",
      "dot.ted",
      "home?x=1",
      "a?b",
      "?",
      null,
      { a: 1 },
      ["a"],
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(cleanProps("join_click", { where: bad })).toEqual({});
    }
    expect(cleanProps("join_click", { where: "x".repeat(40) })).toEqual({ where: "x".repeat(40) });
  });

  it("drops reserved and inherited keys, and non-object props", () => {
    expect(cleanProps("join_click", { $ip: "1.2.3.4", $set: { email: "a@b.example" } })).toEqual({});
    expect(cleanProps("join_click", Object.create({ where: "home" }))).toEqual({});
    expect(cleanProps("join_click", null)).toEqual({});
    expect(cleanProps("join_click", ["home"])).toEqual({});
    expect(cleanProps("join_click", "home")).toEqual({});
  });
});
