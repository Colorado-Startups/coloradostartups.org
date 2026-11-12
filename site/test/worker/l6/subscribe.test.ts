import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handle, kitStatusOutcome, RETURN_PATHS } from "../../../worker/routes/subscribe";
import { expectLimitedBeforeRead, sendBrokenUploads } from "../broken-upload";
import { burstOver, FORM_LIMIT } from "../rate-limit";
import { server } from "../server";
import { kitHandlers, turnstileHandler } from "./kit-handlers";

const ORIGIN = "https://coloradostartups.org";
const URL_ = `${ORIGIN}/api/subscribe`;

// KIT_FORM_ID is not a pool binding yet, so most cases call the handler with
// an explicit env. Each case gets its own IP so the form limiter never trips.
let ipCounter = 0;
const configured = (over: Record<string, unknown> = {}): Env => ({ ...env, KIT_FORM_ID: "1234", ...over }) as Env;

function post(fields: Record<string, string>, ip = `203.0.113.${++ipCounter}`): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(URL_, { method: "POST", body, headers: { "CF-Connecting-IP": ip } });
}

const valid = (over: Record<string, string> = {}) => ({
  email: "Reader@Example.org",
  ts: String(Date.now() - 10_000),
  return_to: "/community/",
  "cf-turnstile-response": "token",
  ...over,
});

const location = (res: Response) => res.headers.get("Location");

describe("POST /api/subscribe with Kit double opt-in", () => {
  it("creates an inactive subscriber, adds it to the form, and sends the visitor to thanks", async () => {
    const kit = kitHandlers();
    server.use(turnstileHandler(true), ...kit.handlers);
    const res = await handle(post(valid()), configured());
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/newsletter/thanks/`);
    expect(kit.seen.map((s) => s.path)).toEqual(["/v4/subscribers", "/v4/forms/1234/subscribers"]);
    expect(kit.seen[0].body).toEqual({ email_address: "reader@example.org", state: "inactive" });
    expect(kit.seen[1].body).toEqual({ email_address: "reader@example.org", referrer: `${ORIGIN}/community/` });
    expect(kit.seen.every((s) => s.apiKey === "test-kit-key")).toBe(true);
  });

  it("answers an address already on the list exactly like a new one", async () => {
    const kit = kitHandlers({ create: 200, addToForm: 200 });
    server.use(turnstileHandler(true), ...kit.handlers);
    const res = await handle(post(valid()), configured());
    expect(location(res)).toBe(`${ORIGIN}/newsletter/thanks/`);
  });

  it("rejects an implausible address before Kit or Turnstile is called", async () => {
    const kit = kitHandlers();
    server.use(...kit.handlers);
    const res = await handle(post(valid({ email: "not-an-email" })), configured());
    expect(location(res)).toBe(`${ORIGIN}/community/?error=invalid`);
    expect(kit.seen).toEqual([]);
  });

  it("reports invalid when Kit rejects the address (422)", async () => {
    const kit = kitHandlers({ create: 422 });
    server.use(turnstileHandler(true), ...kit.handlers);
    const res = await handle(post(valid()), configured());
    expect(location(res)).toBe(`${ORIGIN}/community/?error=invalid`);
    expect(kit.seen).toHaveLength(1);
  });

  it.each([
    ["a 500", { create: 500 }],
    ["a 429", { create: 429 }],
    ["a network failure", { network: true }],
    ["a failed add-to-form", { addToForm: 503 }],
  ])("reports delivery when Kit is down (%s)", async (_label, opts) => {
    const kit = kitHandlers(opts);
    server.use(turnstileHandler(true), ...kit.handlers);
    const res = await handle(post(valid()), configured());
    expect(location(res)).toBe(`${ORIGIN}/community/?error=delivery`);
  });

  // A missing Turnstile secret is our configuration fault, the same as a
  // missing Kit key, so the visitor sees "unavailable", not "verification".
  it.each([
    ["no API key", { KIT_API_KEY: undefined }],
    ["no form id", { KIT_FORM_ID: undefined }],
    ["no Turnstile secret", { TURNSTILE_SECRET_KEY: undefined }],
  ])("says sign-up is unavailable with %s, and calls nobody", async (_label, over) => {
    const kit = kitHandlers();
    server.use(...kit.handlers);
    const res = await handle(post(valid()), configured(over));
    expect(location(res)).toBe(`${ORIGIN}/community/?error=unavailable`);
    expect(kit.seen).toEqual([]);
  });

  it("says unavailable when Kit refuses the key or the form id (401, 404)", async () => {
    for (const opts of [{ create: 401 }, { addToForm: 404 }]) {
      const kit = kitHandlers(opts);
      server.use(turnstileHandler(true), ...kit.handlers);
      const res = await handle(post(valid()), configured());
      expect(location(res)).toBe(`${ORIGIN}/community/?error=unavailable`);
    }
  });

  it("fails verification when Turnstile says no, without calling Kit", async () => {
    const kit = kitHandlers();
    server.use(turnstileHandler(false), ...kit.handlers);
    const res = await handle(post(valid()), configured());
    expect(location(res)).toBe(`${ORIGIN}/community/?error=verification`);
    expect(kit.seen).toEqual([]);
  });

  it("fails verification on a post faster than a person can type", async () => {
    const res = await handle(post(valid({ ts: String(Date.now()) })), configured());
    expect(location(res)).toBe(`${ORIGIN}/community/?error=verification`);
  });

  it("sends a filled honeypot to thanks and calls nobody", async () => {
    const kit = kitHandlers();
    server.use(...kit.handlers);
    const res = await handle(post(valid({ website: "spam" })), configured());
    expect(location(res)).toBe(`${ORIGIN}/newsletter/thanks/`);
    expect(kit.seen).toEqual([]);
  });

  it("never reflects a return path outside the allowlist", async () => {
    for (const bad of ["https://evil.example/", "//evil.example/", "/team/"]) {
      const res = await handle(post(valid({ email: "x", return_to: bad })), configured());
      expect(location(res)).toBe(`${ORIGIN}/newsletter/?error=invalid`);
    }
  });

  it("answers a body that is not form data with a plain 415, not a redirect", async () => {
    const req = new Request(URL_, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    const res = await handle(req, configured());
    expect(res.status).toBe(415);
    expect(location(res)).toBeNull();
  });

  it("sends a malformed form body back to the fallback page as invalid", async () => {
    const req = new Request(URL_, {
      method: "POST",
      body: "not multipart",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "CF-Connecting-IP": "198.51.100.9" },
    });
    const res = await handle(req, configured());
    expect(location(res)).toBe(`${ORIGIN}/newsletter/?error=invalid`);
  });

  it("rejects a streamed body over 8 KB that carries no Content-Length", async () => {
    const kit = kitHandlers();
    server.use(...kit.handlers);
    const big = new TextEncoder().encode(`email=a%40example.org&pad=${"x".repeat(9000)}`);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < big.length; i += 1000) c.enqueue(big.slice(i, i + 1000));
        c.close();
      },
    });
    const req = new Request(URL_, {
      method: "POST",
      body: stream,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "198.51.100.10" },
      // @ts-expect-error duplex is required for a streamed request body
      duplex: "half",
    });
    expect(req.headers.get("Content-Length")).toBeNull();
    const res = await handle(req, configured());
    expect(location(res)).toBe(`${ORIGIN}/newsletter/?error=invalid`);
    expect(kit.seen).toEqual([]);
  });

  it("sends an upload that breaks off mid-read back as invalid (#316)", async () => {
    const kit = kitHandlers();
    server.use(...kit.handlers);
    const req = new Request(URL_, {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("email=a%40example.org"));
          c.error(new Error("connection reset"));
        },
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "198.51.100.11" },
      // @ts-expect-error duplex is required for a streamed request body
      duplex: "half",
    });
    const res = await handle(req, configured());
    expect(location(res)).toBe(`${ORIGIN}/newsletter/?error=invalid`);
    expect(kit.seen).toEqual([]);
  });

  it("accepts a form body of exactly 8 KB and rejects one byte more", async () => {
    server.use(turnstileHandler(true), ...kitHandlers().handlers);
    const sized = (n: number) => {
      const head = new URLSearchParams(valid()).toString() + "&pad=";
      return new Request(URL_, {
        method: "POST",
        body: head + "y".repeat(n - head.length),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": `203.0.113.${++ipCounter}` },
      });
    };
    expect(location(await handle(sized(8192), configured()))).toBe(`${ORIGIN}/newsletter/thanks/`);
    expect(location(await handle(sized(8193), configured()))).toBe(`${ORIGIN}/newsletter/?error=invalid`);
  });

  it("rate-limits a visitor before reading the body", async () => {
    // #429: the route-level proof the other three form routes have (#359).
    // FORM_RATE_LIMIT allows 10 posts per 60 s per IP per route
    // (wrangler.jsonc), and burstOver trips it across a window edge (#339).
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351). Both answers go to the form's fallback
    // page, because no return_to was read.
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), URL_, "192.0.2.66", (req) => handle(req, configured()));
    expectLimitedBeforeRead(answers, `${ORIGIN}/newsletter/?error=invalid`, `${ORIGIN}/newsletter/?error=ratelimit`);
  });

  it("keeps the allowlist L1 places the form on", () => {
    expect(RETURN_PATHS).toEqual(["/", "/newsletter/", "/community/"]);
  });

  it("maps Kit statuses to outcomes", () => {
    expect([200, 201, 202, 422, 401, 403, 404, 429, 500].map(kitStatusOutcome)).toEqual([
      "ok", "ok", "ok", "invalid", "unavailable", "unavailable", "unavailable", "delivery", "delivery",
    ]);
  });
});

describe("POST /api/subscribe through the router", () => {
  it("answers with a 303 and the site security headers", async () => {
    const body = new FormData();
    body.append("website", "spam");
    const res = await SELF.fetch(URL_, { method: "POST", body, redirect: "manual" });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/newsletter/thanks/`);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
