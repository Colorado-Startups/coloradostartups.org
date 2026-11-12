// POST /api/suggest-resource end to end inside workerd: real D1 with every
// migration applied, Turnstile through MSW, and proof that the Worker never
// fetches the URL a visitor suggests (brief section 2.12).
import { createExecutionContext, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { handle, normalizeSuggestedUrl, noteBody, parseSuggestion } from "../../../worker/routes/suggest-resource";
import { expectLimitedBeforeRead, sendBrokenUploads } from "../broken-upload";
import { burstOver, FORM_LIMIT } from "../rate-limit";
import { server } from "../server";
import { turnstileAccepting, turnstileDown } from "./turnstile-handlers";

const ENDPOINT = "https://coloradostartups.org/api/suggest-resource";
const GOOD = "good-token";
let ipCounter = 0;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (overrides: Record<string, string> = {}) => ({
  name: `Founder Legal Clinic ${++ipCounter}`,
  url: "https://clinic.example.org/",
  stage: "launch",
  city: "Denver",
  note: "Free office hours on incorporation.\nTuesdays.",
  email: "founder@example.org",
  ts: String(Date.now() - 10_000),
  "cf-turnstile-response": GOOD,
  return_to: "/ecosystem-canvas/suggest/",
  ...overrides,
});

// Each request gets its own visitor IP so the per-IP form limit never trips
// by accident.
async function post(fields: Record<string, string>, ip = `203.0.113.${(ipCounter % 250) + 1}`) {
  return SELF.fetch(ENDPOINT, {
    method: "POST",
    body: form(fields),
    headers: { "CF-Connecting-IP": ip },
    redirect: "manual",
  });
}

async function rowFor(name: string) {
  return env.DB.prepare("SELECT * FROM resource_suggestions WHERE name = ?").bind(name).first<Record<string, unknown>>();
}

describe("POST /api/suggest-resource", () => {
  it("stores a valid suggestion and redirects to the thanks page", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    const fields = valid();
    const res = await post(fields, "198.51.100.7");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/thanks/");
    const row = await rowFor(fields.name);
    expect(row).toMatchObject({
      status: "new",
      url: "https://clinic.example.org/",
      stage: "launch",
      city: "Denver",
      note: "Free office hours on incorporation.\nTuesdays.",
      submitter_email: "founder@example.org",
    });
    expect(seen[0].get("secret")).toBe("test-secret");
    expect(seen[0].get("remoteip")).toBe("198.51.100.7");
  });

  it("never fetches the suggested URL", async () => {
    let visits = 0;
    server.use(
      turnstileAccepting(GOOD),
      http.all("https://suggested.example.org/*", () => {
        visits += 1;
        return HttpResponse.text("hello");
      }),
    );
    const fields = valid({ url: "https://suggested.example.org/page" });
    expect((await post(fields)).status).toBe(303);
    expect(await rowFor(fields.name)).not.toBeNull();
    expect(visits).toBe(0);
  });

  it("adds https:// to an address typed without a scheme", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ url: "acme-coworking.example" });
    await post(fields);
    expect((await rowFor(fields.name))?.url).toBe("https://acme-coworking.example/");
  });

  it("stores empty optional fields as NULL", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ stage: "", city: "", note: "", email: "" });
    await post(fields);
    expect(await rowFor(fields.name)).toMatchObject({ stage: null, city: null, note: null, submitter_email: null });
  });

  it("answers a filled honeypot with the thanks page and stores nothing", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ website: "https://spam.example" });
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/thanks/");
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("sends a post that came too fast back with error=verification", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ ts: String(Date.now()) });
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/?error=verification");
    expect(await rowFor(fields.name)).toBeNull();
  });

  it.each([
    ["a javascript: link", { url: "javascript:alert(1)" }],
    ["an ftp link", { url: "ftp://files.example.org/" }],
    ["a host with no dot", { url: "http://localhost:8787/" }],
    ["a link with a password", { url: "https://user:pw@example.org/" }],
    ["an over-long link", { url: `https://example.org/${"a".repeat(300)}` }],
    ["a missing name", { name: "" }],
    ["an unknown stage", { stage: "unicorn" }],
    ["a bad email", { email: "not-an-email" }],
    ["an over-long city", { city: "x".repeat(61) }],
  ])("rejects %s with error=invalid", async (_label, override) => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid(override);
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/?error=invalid");
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("rejects a bad Turnstile token and fails closed when Turnstile is down", async () => {
    server.use(turnstileAccepting(GOOD));
    const bad = valid({ "cf-turnstile-response": "forged" });
    expect((await post(bad)).headers.get("Location")).toMatch(/\?error=verification$/);
    expect(await rowFor(bad.name)).toBeNull();

    server.use(turnstileDown());
    const down = valid();
    expect((await post(down)).headers.get("Location")).toMatch(/\?error=verification$/);
    expect(await rowFor(down.name)).toBeNull();
  });

  it("closes the form with error=unavailable when the Turnstile secret is missing", async () => {
    const fields = valid();
    const request = new Request(ENDPOINT, { method: "POST", body: form(fields), headers: { "CF-Connecting-IP": "192.0.2.42" } });
    const res = await handle(request, { ...env, TURNSTILE_SECRET_KEY: undefined }, createExecutionContext());
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/?error=unavailable");
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("redirects without waiting on the notice to Paul, which runs through waitUntil", async () => {
    server.use(turnstileAccepting(GOOD));
    const sent: unknown[] = [];
    let release = () => {};
    // A send that never settles until released. A route that awaited it
    // before redirecting would still be waiting when the timer fires.
    const FORM_EMAIL = {
      send: (message: unknown) => {
        sent.push(message);
        return new Promise<void>((resolve) => (release = resolve));
      },
    };
    const fields = valid();
    const request = new Request(ENDPOINT, { method: "POST", body: form(fields), headers: { "CF-Connecting-IP": "192.0.2.43" } });
    const ctx = createExecutionContext();
    const answered = await Promise.race([
      handle(request, { ...env, FORM_EMAIL } as unknown as Env, ctx),
      new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), 2000)),
    ]);
    expect(answered).toBeInstanceOf(Response);
    expect((answered as Response).headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/thanks/");
    expect(sent).toHaveLength(1);
    release();
    await waitOnExecutionContext(ctx);
    expect(await rowFor(fields.name)).not.toBeNull();
  });

  it("reflects only an allowlisted return_to", async () => {
    server.use(turnstileAccepting(GOOD));
    const toCanvas = await post(valid({ name: "", return_to: "/ecosystem-canvas/" }));
    expect(toCanvas.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/?error=invalid");
    const evil = await post(valid({ name: "", return_to: "https://evil.example/" }));
    expect(evil.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/?error=invalid");
  });

  it("turns away a visitor over the per-IP limit before reading the body", async () => {
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351).
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), ENDPOINT, "192.0.2.99", (req) => handle(req, env, createExecutionContext()));
    expectLimitedBeforeRead(
      answers,
      "https://coloradostartups.org/ecosystem-canvas/suggest/?error=invalid",
      "https://coloradostartups.org/ecosystem-canvas/suggest/?error=ratelimit",
    );
  });

  it("rejects a body over the form byte cap (decision 35)", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ note: "x".repeat(17 * 1024) });
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/ecosystem-canvas/suggest/?error=invalid");
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("answers GET with 405", async () => {
    const res = await SELF.fetch(ENDPOINT, { method: "GET" });
    expect(res.status).toBe(405);
  });
});

describe("the notification to Paul", () => {
  it("carries the name, the link and the row id, never the suggester's email", () => {
    const s = { name: "Acme", url: "https://acme.example/", stage: null, city: "Denver", note: "a note", email: "person@example.org" };
    const body = noteBody(s, 7);
    expect(body).toContain("Acme");
    expect(body).toContain("https://acme.example/");
    expect(body).toContain("id 7");
    expect(body).not.toContain("person@example.org");
    expect(body).not.toContain("a note");
  });
});

describe("parseSuggestion and normalizeSuggestedUrl", () => {
  it("strips line breaks from single-line fields and control characters from the note", () => {
    const parsed = parseSuggestion(form({ name: "Acme\r\nBcc: x@y.z", url: "acme.example", note: "a\u0007b\r\nc" }));
    expect(parsed).toEqual({ name: "Acme Bcc: x@y.z", url: "https://acme.example/", stage: null, city: null, note: "ab\nc", email: null });
  });

  it("keeps http and https only", () => {
    expect(normalizeSuggestedUrl("http://example.org")).toBe("http://example.org/");
    expect(normalizeSuggestedUrl("data:text/html,hi")).toBeNull();
    expect(normalizeSuggestedUrl("")).toBeNull();
  });
});
