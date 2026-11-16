// POST /api/spotlight end to end inside workerd (step P3a): real D1 with
// every migration applied, Turnstile through MSW (L3's handlers), the notice
// email through a fake FORM_EMAIL binding, and the never-fetch rule (BRIEF
// hard constraint 12). The plan's test for this step is literal: no consent,
// no save. Fixtures use example.org and invented names only.
import { createExecutionContext, createScheduledController, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SPOTLIGHT_CONSENT, SPOTLIGHT_CONSENT_VERSION } from "../../src/components/spotlight/fields";
import worker from "../../worker/index";
import { handle, purgeSpotlightRequests, SPOTLIGHT_RETENTION_DAYS } from "../../worker/routes/spotlight";
import { expectLimitedBeforeRead, sendBrokenUploads } from "./broken-upload";
import { turnstileAccepting, turnstileDown } from "./l3/turnstile-handlers";
import { burstOver, FORM_LIMIT } from "./rate-limit";
import { server } from "./server";

const BASE = "https://coloradostartups.org";
const ENDPOINT = `${BASE}/api/spotlight`;
const FORM_PAGE = `${BASE}/get-featured/`;
const THANKS = `${BASE}/get-featured/thanks/`;
const GOOD = "good-token";
let n = 0;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (over: Record<string, string> = {}) => ({
  first_name: "Testa",
  last_name: `Founder ${++n}`,
  email: "founder@example.org",
  role: "Cofounder and CEO",
  company: "Switchback Example Co.",
  company_website: "https://example.org/",
  city: "Salida",
  building: "Trail maps that update themselves after every storm.",
  linkedin: "https://www.linkedin.com/in/test-founder",
  founder: "on",
  consent_show: "on",
  ts: String(Date.now() - 10_000),
  "cf-turnstile-response": GOOD,
  ...over,
});

type Row = Record<string, string | number | null>;
const rowFor = (lastName: string) =>
  env.DB.prepare("SELECT * FROM spotlight_requests WHERE last_name = ?").bind(lastName).first<Row>();
const total = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM spotlight_requests").first<{ n: number }>())?.n ?? -1;

// A FORM_EMAIL binding that records each send, or fails each one.
function fakeEmail(fail = false) {
  const sent: unknown[] = [];
  const binding = {
    send: async (message: unknown) => {
      sent.push(message);
      if (fail) throw new Error("send refused");
    },
  };
  return { sent, binding };
}

// Calls the route directly, so a test can swap bindings and wait for the
// notice that runs in waitUntil.
async function call(fields: Record<string, string>, over: Partial<Env> = {}, ip = `203.0.113.${(n % 250) + 1}`) {
  const ctx = createExecutionContext();
  const request = new Request(ENDPOINT, { method: "POST", body: form(fields), headers: { "CF-Connecting-IP": ip } });
  const res = await handle(request, { ...env, ...over } as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the consent wording", () => {
  it("is the wording version 2026-11-16 names; a new sentence needs a new version", () => {
    expect(SPOTLIGHT_CONSENT_VERSION).toBe("2026-11-16");
    expect(SPOTLIGHT_CONSENT).toEqual({
      founder: "I am a founder or cofounder of this company.",
      show: "Colorado Startups may show my name, role, company, city and this line on its website. I can ask to be removed at any time.",
    });
  });
});

describe("POST /api/spotlight", () => {
  it("stores a valid request with its consent time and version, emails Paul once and redirects to the thanks page", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    const email = fakeEmail();
    const fields = valid();
    const before = Date.now();
    const res = await call(fields, { FORM_EMAIL: email.binding as unknown as SendEmail }, "198.51.100.70");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(THANKS);
    const row = await rowFor(fields.last_name);
    expect(row).toMatchObject({
      status: "new",
      decided_at: null,
      first_name: "Testa",
      email: "founder@example.org",
      role: "Cofounder and CEO",
      company: "Switchback Example Co.",
      company_website: "https://example.org/",
      city: "Salida",
      building: "Trail maps that update themselves after every storm.",
      linkedin: "https://www.linkedin.com/in/test-founder",
      founder: 1,
      consent_show: 1,
      consent_version: SPOTLIGHT_CONSENT_VERSION,
    });
    const consentAt = Date.parse(String(row?.consent_at));
    expect(consentAt).toBeGreaterThanOrEqual(before - 1000);
    expect(consentAt).toBeLessThanOrEqual(Date.now());
    expect(row?.consent_at).toBe(row?.created_at);
    expect(email.sent).toHaveLength(1);
    expect(seen[0]?.get("secret")).toBe("test-secret");
    expect(seen[0]?.get("remoteip")).toBe("198.51.100.70");
  });

  it("is routed through the Worker's route table", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid();
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      body: form(fields),
      headers: { "CF-Connecting-IP": "198.51.100.71" },
      redirect: "manual",
    });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).not.toBeNull();
  });

  it("answers GET with 405", async () => {
    expect((await SELF.fetch(ENDPOINT, { method: "GET" })).status).toBe(405);
  });

  it("adds https:// to links typed without it, and stores a blank LinkedIn link as NULL", async () => {
    server.use(turnstileAccepting(GOOD));
    const typed = valid({ company_website: "example.net", linkedin: "linkedin.com/in/test-founder" });
    const blank = valid({ linkedin: "" });
    for (const f of [typed, blank]) expect((await call(f)).headers.get("Location")).toBe(THANKS);
    expect(await rowFor(typed.last_name)).toMatchObject({
      company_website: "https://example.net/",
      linkedin: "https://linkedin.com/in/test-founder",
    });
    expect((await rowFor(blank.last_name))?.linkedin).toBeNull();
  });

  describe("no consent, no save", () => {
    it.each([
      ["the founder box", { founder: "" }, "founder"],
      ["the show-me box", { consent_show: "" }, "consent_show"],
    ])("refuses a request without %s and stores nothing", async (_label, over, field) => {
      server.use(turnstileAccepting(GOOD));
      await env.DB.prepare("DELETE FROM spotlight_requests").run();
      const email = fakeEmail();
      const res = await call(valid(over), { FORM_EMAIL: email.binding as unknown as SendEmail });
      expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=${field}&error=invalid`);
      expect(await total()).toBe(0);
      expect(email.sent).toHaveLength(0);
    });

    it("refuses a request without either box, naming both", async () => {
      server.use(turnstileAccepting(GOOD));
      await env.DB.prepare("DELETE FROM spotlight_requests").run();
      const res = await call(valid({ founder: "", consent_show: "" }));
      expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=founder&field=consent_show&error=invalid`);
      expect(await total()).toBe(0);
    });
  });

  it.each([
    ["a missing first name", { first_name: "" }, "first_name"],
    ["a missing last name", { last_name: "" }, "last_name"],
    ["a missing email", { email: "" }, "email"],
    ["a bad email", { email: "not-an-email" }, "email"],
    ["a missing role", { role: "" }, "role"],
    ["a role over the cap", { role: "x".repeat(81) }, "role"],
    ["a missing company", { company: "" }, "company"],
    ["a company over the cap", { company: "x".repeat(161) }, "company"],
    ["a missing website", { company_website: "" }, "company_website"],
    ["an http website", { company_website: "http://example.org/" }, "company_website"],
    ["a javascript: website", { company_website: "javascript:alert(1)" }, "company_website"],
    ["a website with no dotted host", { company_website: "https://localhost/" }, "company_website"],
    ["a missing city", { city: "" }, "city"],
    ["a city over the cap", { city: "x".repeat(81) }, "city"],
    ["a missing line", { building: "" }, "building"],
    ["a line over 140 characters", { building: "x".repeat(141) }, "building"],
    ["an http LinkedIn link", { linkedin: "http://www.linkedin.com/in/x" }, "linkedin"],
    ["a LinkedIn link on a lookalike host", { linkedin: "https://linkedin.com.evil.example/in/x" }, "linkedin"],
    ["a LinkedIn link on another host", { linkedin: "https://example.org/in/x" }, "linkedin"],
    ["a LinkedIn link with no path", { linkedin: "https://www.linkedin.com/" }, "linkedin"],
  ])("sends %s back with error=invalid naming the field", async (_label, over, field) => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid(over);
    const log = vi.spyOn(console, "log");
    const res = await call(fields);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=${field}&error=invalid`);
    // The log names the field, never what was typed.
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(`spotlight: invalid fields ${field}`);
    for (const value of [...Object.values(over), fields.email, fields.last_name]) {
      if (value.length > 3) expect(logged).not.toContain(value);
    }
    expect(await rowFor(fields.last_name)).toBeNull();
  });

  it("accepts a line of exactly 140 characters", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ building: "x".repeat(140) });
    expect((await call(fields)).headers.get("Location")).toBe(THANKS);
    expect(String((await rowFor(fields.last_name))?.building)).toHaveLength(140);
  });

  it("answers a filled honeypot with the thanks page and stores nothing", async () => {
    server.use(turnstileAccepting(GOOD));
    const email = fakeEmail();
    const fields = valid({ website: "https://spam.example" });
    const res = await call(fields, { FORM_EMAIL: email.binding as unknown as SendEmail });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).toBeNull();
    expect(email.sent).toHaveLength(0);
  });

  it("sends a post that came too fast back with error=verification", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ ts: String(Date.now()) });
    expect((await call(fields)).headers.get("Location")).toBe(`${FORM_PAGE}?error=verification`);
    expect(await rowFor(fields.last_name)).toBeNull();
  });

  it("refuses a bad Turnstile token and fails closed when Turnstile is down", async () => {
    server.use(turnstileAccepting(GOOD));
    const bad = valid({ "cf-turnstile-response": "forged" });
    expect((await call(bad)).headers.get("Location")).toBe(`${FORM_PAGE}?error=verification`);
    expect(await rowFor(bad.last_name)).toBeNull();

    server.use(turnstileDown());
    const down = valid();
    expect((await call(down)).headers.get("Location")).toBe(`${FORM_PAGE}?error=verification`);
    expect(await rowFor(down.last_name)).toBeNull();
  });

  it("closes the form with error=unavailable when the Turnstile secret is missing", async () => {
    const fields = valid();
    const res = await call(fields, { TURNSTILE_SECRET_KEY: undefined });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=unavailable`);
    expect(await rowFor(fields.last_name)).toBeNull();
  });

  it("never fetches the website or the LinkedIn link", async () => {
    let visits = 0;
    server.use(
      turnstileAccepting(GOOD),
      http.all("https://www.linkedin.com/*", () => {
        visits += 1;
        return HttpResponse.text("profile");
      }),
      http.all("https://example.org/*", () => {
        visits += 1;
        return HttpResponse.text("site");
      }),
    );
    const res = await call(valid(), { FORM_EMAIL: fakeEmail().binding as unknown as SendEmail });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(visits).toBe(0);
  });

  it("still saves the request and thanks the visitor when the notice email fails, and logs no personal data", async () => {
    server.use(turnstileAccepting(GOOD));
    const email = fakeEmail(true);
    const errors = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");
    const fields = valid();
    const res = await call(fields, { FORM_EMAIL: email.binding as unknown as SendEmail });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).toMatchObject({ status: "new", founder: 1, consent_show: 1 });
    expect(email.sent).toHaveLength(1);
    const logged = [...errors.mock.calls, ...log.mock.calls].map((c) => c.map(String).join(" "));
    expect(logged.some((l) => l.startsWith("notify failed:"))).toBe(true);
    for (const value of [fields.first_name, fields.last_name, fields.email, fields.company, fields.linkedin, fields.building]) {
      expect(logged.join("\n")).not.toContain(value);
    }
  });

  it("still saves the request when the email binding is not set, and logs the skip", async () => {
    server.use(turnstileAccepting(GOOD));
    const log = vi.spyOn(console, "log");
    const fields = valid();
    const res = await call(fields, { FORM_EMAIL: undefined });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).toMatchObject({ status: "new" });
    expect(log.mock.calls.some((c) => String(c[0]) === "notify skipped: FORM_EMAIL binding not configured")).toBe(true);
  });

  it("tells the visitor when the row cannot be stored, sends no email, and logs the failure without the person's details", async () => {
    server.use(turnstileAccepting(GOOD));
    const email = fakeEmail();
    const errors = vi.spyOn(console, "error");
    const brokenDb = {
      prepare() {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;
    const fields = valid();
    const res = await call(fields, { DB: brokenDb, FORM_EMAIL: email.binding as unknown as SendEmail });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=delivery`);
    expect(email.sent).toHaveLength(0);
    const logged = errors.mock.calls.map((c) => c.map(String).join(" "));
    expect(logged.find((l) => l.startsWith("spotlight: insert failed:"))).toBe("spotlight: insert failed: D1 unavailable");
    for (const value of [fields.first_name, fields.last_name, fields.email, fields.company]) {
      expect(logged.join("\n")).not.toContain(value);
    }
  });

  it("rejects a body over the form byte cap (decision 35)", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ company: "x".repeat(17 * 1024) });
    expect((await call(fields)).headers.get("Location")).toBe(`${FORM_PAGE}?error=invalid`);
    expect(await rowFor(fields.last_name)).toBeNull();
  });

  it("turns away a visitor over the per-IP limit before reading the body", async () => {
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351).
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), ENDPOINT, "192.0.2.207", (req) =>
      handle(req, env, createExecutionContext()),
    );
    expectLimitedBeforeRead(answers, `${FORM_PAGE}?error=invalid`, `${FORM_PAGE}?error=ratelimit`);
  });
});

// The CHECKs in 0003_spotlight_requests.sql hold the form's rules, so a
// hand-typed statement cannot break them, consent above all.
describe("the spotlight_requests table's CHECKs", () => {
  const insert = (over: Record<string, string | number | null> = {}) => {
    const row = {
      status: "new",
      decided_at: null,
      company_website: "https://example.org/",
      building: "A line",
      linkedin: null,
      founder: 1,
      consent_show: 1,
      consent_version: SPOTLIGHT_CONSENT_VERSION,
      ...over,
    };
    return env.DB.prepare(
      "INSERT INTO spotlight_requests (created_at, status, decided_at, first_name, last_name, email, role, company, company_website, city, building, linkedin, founder, consent_show, consent_at, consent_version) VALUES ('2026-11-16T00:00:00Z', ?, ?, 'Check', 'Founder', 'check@example.org', 'Cofounder', 'Check Example Co', ?, 'Salida', ?, ?, ?, ?, '2026-11-16T00:00:00Z', ?)",
    )
      .bind(
        row.status,
        row.decided_at,
        row.company_website,
        row.building,
        row.linkedin,
        row.founder,
        row.consent_show,
        row.consent_version,
      )
      .run();
  };

  it("accepts every status with its decided time, and the LinkedIn links the form accepts", async () => {
    await insert();
    await insert({ status: "published", decided_at: "2026-11-20T00:00:00Z" });
    await insert({ status: "declined", decided_at: "2026-11-20T00:00:00Z" });
    await insert({ linkedin: "https://www.linkedin.com/in/check" });
    await insert({ linkedin: "https://linkedin.com/in/check" });
    await insert({ building: "x".repeat(140) });
  });

  it.each([
    ["no founder box", { founder: 0 }],
    ["no show-me box", { consent_show: 0 }],
    ["no consent version", { consent_version: "" }],
  ])("refuses a direct insert with %s, so the table stays empty of it", async (_label, over) => {
    await env.DB.prepare("DELETE FROM spotlight_requests").run();
    await expect(insert(over)).rejects.toThrow(/CHECK constraint failed/);
    expect(await total()).toBe(0);
  });

  it.each([
    ["an unknown status", { status: "featured", decided_at: "2026-11-20T00:00:00Z" }],
    ["a decided status with no decided time", { status: "published" }],
    ["a new request with a decided time", { decided_at: "2026-11-20T00:00:00Z" }],
    ["an http website", { company_website: "http://example.org/" }],
    ["a line over 140 characters", { building: "x".repeat(141) }],
    ["an empty line", { building: "" }],
    ["a LinkedIn link on another host", { linkedin: "https://example.org/in/check" }],
    ["a LinkedIn link on a lookalike host", { linkedin: "https://linkedin.com.evil.example/in/check" }],
    ["a LinkedIn link hiding another host", { linkedin: "https://evil.example#.linkedin.com/in/check" }],
    ["a LinkedIn link with no path", { linkedin: "https://www.linkedin.com/" }],
    ["an http LinkedIn link", { linkedin: "http://www.linkedin.com/in/check" }],
  ])("refuses %s", async (_label, over) => {
    await expect(insert(over)).rejects.toThrow(/CHECK constraint failed/);
  });

  it("stores no IP address", async () => {
    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('spotlight_requests')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name).filter((c) => /ip|addr/i.test(c))).toEqual([]);
  });
});

// Retention (privacy policy, Asking to be featured): the weekly job deletes
// each request 180 days after it arrives, whatever its status.
describe("the weekly spotlight_requests purge", () => {
  const DAY = 86_400_000;
  const NOW = new Date("2026-11-16T12:00:00Z");
  const insert = (createdAt: string, lastName: string, status = "new") =>
    env.DB.prepare(
      "INSERT INTO spotlight_requests (created_at, status, decided_at, first_name, last_name, email, role, company, company_website, city, building, founder, consent_show, consent_at, consent_version) VALUES (?1, ?2, ?3, 'Purge', ?4, 'purge@example.org', 'Cofounder', 'Purge Example Co', 'https://example.org/', 'Salida', 'A line', 1, 1, ?1, '2026-11-16')",
    )
      .bind(createdAt, status, status === "new" ? null : createdAt, lastName)
      .run();

  it("keeps 180 days", () => {
    expect(SPOTLIGHT_RETENTION_DAYS).toBe(180);
  });

  it("deletes a request at 181 days, whatever its status, and keeps one at 179", async () => {
    await env.DB.prepare("DELETE FROM spotlight_requests").run();
    await insert(new Date(NOW.getTime() - 181 * DAY).toISOString(), "Purge Old New");
    await insert(new Date(NOW.getTime() - 181 * DAY).toISOString(), "Purge Old Published", "published");
    await insert(new Date(NOW.getTime() - 179 * DAY).toISOString(), "Purge Recent");
    expect(await purgeSpotlightRequests(env.DB, NOW)).toBe(2);
    expect(await rowFor("Purge Old New")).toBeNull();
    expect(await rowFor("Purge Old Published")).toBeNull();
    expect(await rowFor("Purge Recent")).not.toBeNull();
    expect(await purgeSpotlightRequests(env.DB, NOW)).toBe(0);
  });

  it("runs in the scheduled handler's RETENTION jobs and logs a count only", async () => {
    await env.DB.prepare("DELETE FROM spotlight_requests").run();
    await insert(new Date(Date.now() - 200 * DAY).toISOString(), "Purge Scheduled");
    const log = vi.spyOn(console, "log");
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "17 9 * * 1" }), env, ctx);
    await waitOnExecutionContext(ctx);
    const lines = log.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.startsWith("spotlight_requests purge"));
    expect(lines).toEqual(["spotlight_requests purge: 1 deleted"]);
    expect(await rowFor("Purge Scheduled")).toBeNull();
  });
});
