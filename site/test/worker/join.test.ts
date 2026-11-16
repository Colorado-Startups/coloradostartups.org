// POST /api/join end to end inside workerd (step P5a): real D1 with every
// migration applied, Turnstile through MSW (L3's handlers), the notice email
// through a fake FORM_EMAIL binding, and the never-fetch rule (BRIEF hard
// constraint 12). Fixtures use example.org and invented names only.
import { createExecutionContext, createScheduledController, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BASED_CHOICES, DESCRIBES_CHOICES, HEARD_CHOICES } from "../../src/components/join/fields";
import worker from "../../worker/index";
import { handle, JOIN_REQUEST_RETENTION_DAYS, purgeJoinRequests } from "../../worker/routes/join";
import { expectLimitedBeforeRead, sendBrokenUploads } from "./broken-upload";
import { turnstileAccepting, turnstileDown } from "./l3/turnstile-handlers";
import { burstOver, FORM_LIMIT } from "./rate-limit";
import { server } from "./server";

const BASE = "https://coloradostartups.org";
const ENDPOINT = `${BASE}/api/join`;
const FORM_PAGE = `${BASE}/join/slack/`;
const THANKS = `${BASE}/join/slack/thanks/`;
const GOOD = "good-token";
let n = 0;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (over: Record<string, string> = {}) => ({
  first_name: "Testa",
  last_name: `Requester ${++n}`,
  email: "requester@example.org",
  linkedin: "https://www.linkedin.com/in/test-requester",
  based: "colorado",
  city: "Summit County",
  describes: "founder",
  heard: "event",
  ts: String(Date.now() - 10_000),
  "cf-turnstile-response": GOOD,
  ...over,
});

type Row = Record<string, string | number | null>;
const rowFor = (lastName: string) =>
  env.DB.prepare("SELECT * FROM slack_join_requests WHERE last_name = ?").bind(lastName).first<Row>();

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

describe("POST /api/join", () => {
  it("stores a valid request, emails Paul once and redirects to the thanks page", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    const email = fakeEmail();
    const fields = valid();
    const res = await call(fields, { FORM_EMAIL: email.binding as unknown as SendEmail }, "198.51.100.50");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).toMatchObject({
      status: "new",
      first_name: "Testa",
      email: "requester@example.org",
      linkedin: "https://www.linkedin.com/in/test-requester",
      based: "colorado",
      city: "Summit County",
      describes: "founder",
      heard: "event",
      newsletter: 0,
      decided_at: null,
    });
    expect(email.sent).toHaveLength(1);
    expect(seen[0]?.get("secret")).toBe("test-secret");
    expect(seen[0]?.get("remoteip")).toBe("198.51.100.50");
  });

  it("is routed through the Worker's route table", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid();
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      body: form(fields),
      headers: { "CF-Connecting-IP": "198.51.100.51" },
      redirect: "manual",
    });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).not.toBeNull();
  });

  it("answers GET with 405", async () => {
    expect((await SELF.fetch(ENDPOINT, { method: "GET" })).status).toBe(405);
  });

  it("adds https:// to a LinkedIn link typed without it", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ linkedin: "linkedin.com/in/test-requester" });
    expect((await call(fields)).headers.get("Location")).toBe(THANKS);
    expect((await rowFor(fields.last_name))?.linkedin).toBe("https://linkedin.com/in/test-requester");
  });

  it("stores the newsletter flag only when the box is ticked", async () => {
    server.use(turnstileAccepting(GOOD));
    const ticked = valid({ newsletter: "on" });
    const unticked = valid();
    const empty = valid({ newsletter: "" });
    for (const f of [ticked, unticked, empty]) expect((await call(f)).headers.get("Location")).toBe(THANKS);
    expect((await rowFor(ticked.last_name))?.newsletter).toBe(1);
    expect((await rowFor(unticked.last_name))?.newsletter).toBe(0);
    expect((await rowFor(empty.last_name))?.newsletter).toBe(0);
  });

  it("needs a city only from someone based in Colorado", async () => {
    server.use(turnstileAccepting(GOOD));
    const missing = valid({ city: "" });
    expect((await call(missing)).headers.get("Location")).toBe(`${FORM_PAGE}?field=city&error=invalid`);
    expect(await rowFor(missing.last_name)).toBeNull();

    for (const based of ["connected", "other"]) {
      const outside = valid({ based, city: "" });
      expect((await call(outside)).headers.get("Location"), based).toBe(THANKS);
      expect(await rowFor(outside.last_name)).toMatchObject({ based, city: null });
    }
  });

  it("stores an unanswered how-you-heard as NULL", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ heard: "" });
    expect((await call(fields)).headers.get("Location")).toBe(THANKS);
    expect((await rowFor(fields.last_name))?.heard).toBeNull();
  });

  it.each([
    ["a missing first name", { first_name: "" }, "first_name"],
    ["a missing last name", { last_name: "" }, "last_name"],
    ["a missing email", { email: "" }, "email"],
    ["a bad email", { email: "not-an-email" }, "email"],
    ["a missing LinkedIn link", { linkedin: "" }, "linkedin"],
    ["an http LinkedIn link", { linkedin: "http://www.linkedin.com/in/x" }, "linkedin"],
    ["a LinkedIn link on a lookalike host", { linkedin: "https://linkedin.com.evil.example/in/x" }, "linkedin"],
    ["a LinkedIn link on another host", { linkedin: "https://example.org/in/x" }, "linkedin"],
    ["a LinkedIn link with no path", { linkedin: "https://www.linkedin.com/" }, "linkedin"],
    ["a javascript: link", { linkedin: "javascript:alert(1)" }, "linkedin"],
    ["a missing based", { based: "" }, "based"],
    ["an unknown based", { based: "mars" }, "based"],
    ["a missing describes", { describes: "" }, "describes"],
    ["an unknown describes", { describes: "astronaut" }, "describes"],
    ["an unknown heard", { heard: "billboard" }, "heard"],
    ["a city over the cap", { city: "x".repeat(81) }, "city"],
  ])("sends %s back with error=invalid naming the field", async (_label, over, field) => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid(over);
    const log = vi.spyOn(console, "log");
    const res = await call(fields);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=${field}&error=invalid`);
    // The log names the field, never what was typed.
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(`join: invalid fields ${field}`);
    for (const value of Object.values(over)) if (value.length > 3) expect(logged).not.toContain(value);
    expect(await rowFor(fields.last_name)).toBeNull();
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

  it("never fetches the LinkedIn link", async () => {
    let visits = 0;
    server.use(
      turnstileAccepting(GOOD),
      http.all("https://www.linkedin.com/*", () => {
        visits += 1;
        return HttpResponse.text("profile");
      }),
    );
    const fields = valid();
    expect((await call(fields, { FORM_EMAIL: fakeEmail().binding as unknown as SendEmail })).headers.get("Location")).toBe(
      THANKS,
    );
    expect(visits).toBe(0);
  });

  it("still saves the request and thanks the visitor when the notice email fails, and logs the failure", async () => {
    server.use(turnstileAccepting(GOOD));
    const email = fakeEmail(true);
    const errors = vi.spyOn(console, "error");
    const fields = valid();
    const res = await call(fields, { FORM_EMAIL: email.binding as unknown as SendEmail });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).toMatchObject({ status: "new" });
    expect(email.sent).toHaveLength(1);
    expect(errors.mock.calls.some((c) => String(c[0]).startsWith("notify failed:"))).toBe(true);
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
    const line = logged.find((l) => l.startsWith("join: insert failed:"));
    expect(line).toBe("join: insert failed: D1 unavailable");
    for (const value of [fields.first_name, fields.last_name, fields.email, fields.linkedin]) {
      expect(logged.join("\n")).not.toContain(value);
    }
  });

  it("still saves the request and thanks the visitor when the email binding is not set, and logs the skip", async () => {
    server.use(turnstileAccepting(GOOD));
    const log = vi.spyOn(console, "log");
    const fields = valid();
    const res = await call(fields, { FORM_EMAIL: undefined });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.last_name)).toMatchObject({ status: "new" });
    expect(log.mock.calls.some((c) => String(c[0]) === "notify skipped: FORM_EMAIL binding not configured")).toBe(true);
  });

  it("rejects a body over the form byte cap (decision 35)", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ city: "x".repeat(17 * 1024) });
    expect((await call(fields)).headers.get("Location")).toBe(`${FORM_PAGE}?error=invalid`);
    expect(await rowFor(fields.last_name)).toBeNull();
  });

  it("turns away a visitor over the per-IP limit before reading the body", async () => {
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351).
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), ENDPOINT, "192.0.2.205", (req) =>
      handle(req, env, createExecutionContext()),
    );
    expectLimitedBeforeRead(answers, `${FORM_PAGE}?error=invalid`, `${FORM_PAGE}?error=ratelimit`);
  });
});

// The CHECKs in 0500_slack_join_requests.sql hold the same choice ids as the
// form, so the two lists cannot drift and a hand-typed statement cannot
// break them.
describe("the slack_join_requests table's CHECKs", () => {
  const insert = (over: Record<string, string | number | null> = {}) => {
    const row = {
      based: "colorado",
      city: "Durango",
      describes: "founder",
      heard: null,
      newsletter: 0,
      status: "new",
      ...over,
    };
    return env.DB.prepare(
      "INSERT INTO slack_join_requests (created_at, status, first_name, last_name, email, linkedin, based, city, describes, heard, newsletter) VALUES ('2026-11-16T00:00:00Z', ?, 'Check', 'Requester', 'check@example.org', 'https://www.linkedin.com/in/check', ?, ?, ?, ?, ?)",
    )
      .bind(row.status, row.based, row.city, row.describes, row.heard, row.newsletter)
      .run();
  };

  it("accepts every choice id the form offers", async () => {
    for (const [based] of BASED_CHOICES) await insert({ based });
    for (const [describes] of DESCRIBES_CHOICES) await insert({ describes });
    for (const [heard] of HEARD_CHOICES) await insert({ heard });
  });

  it.each([
    ["an unknown based", { based: "mars" }],
    ["an unknown describes", { describes: "astronaut" }],
    ["an unknown heard", { heard: "billboard" }],
    ["a newsletter flag other than 0 or 1", { newsletter: 2 }],
    ["an unknown status", { status: "invted" }],
    ["a Colorado request with no city", { city: null }],
    ["a Colorado request with an empty city", { city: "" }],
  ])("refuses %s", async (_label, over) => {
    await expect(insert(over)).rejects.toThrow(/CHECK constraint failed/);
  });

  it("stores no IP address", async () => {
    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('slack_join_requests')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name).filter((c) => /ip|addr/i.test(c))).toEqual([]);
  });
});

// Retention (privacy policy, Asking to join our Slack on this site): the
// weekly job deletes each request 90 days after it arrives, whatever its
// status.
describe("the weekly slack_join_requests purge", () => {
  const DAY = 86_400_000;
  const NOW = new Date("2026-11-16T12:00:00Z");
  const insert = (createdAt: string, lastName: string, status = "new") =>
    env.DB.prepare(
      "INSERT INTO slack_join_requests (created_at, status, first_name, last_name, email, linkedin, based, city, describes) VALUES (?, ?, 'Purge', ?, 'purge@example.org', 'https://www.linkedin.com/in/purge', 'other', NULL, 'other')",
    )
      .bind(createdAt, status, lastName)
      .run();

  it("keeps 90 days", () => {
    expect(JOIN_REQUEST_RETENTION_DAYS).toBe(90);
  });

  it("deletes a request older than 90 days, whatever its status, and keeps one at 89 days", async () => {
    await env.DB.prepare("DELETE FROM slack_join_requests").run();
    await insert(new Date(NOW.getTime() - 91 * DAY).toISOString(), "Purge Old New");
    await insert(new Date(NOW.getTime() - 91 * DAY).toISOString(), "Purge Old Invited", "invited");
    await insert(new Date(NOW.getTime() - 89 * DAY).toISOString(), "Purge Recent");
    expect(await purgeJoinRequests(env.DB, NOW)).toBe(2);
    expect(await rowFor("Purge Old New")).toBeNull();
    expect(await rowFor("Purge Old Invited")).toBeNull();
    expect(await rowFor("Purge Recent")).not.toBeNull();
    expect(await purgeJoinRequests(env.DB, NOW)).toBe(0);
  });

  it("runs in the scheduled handler's RETENTION jobs and logs a count only", async () => {
    await env.DB.prepare("DELETE FROM slack_join_requests").run();
    await insert(new Date(Date.now() - 100 * DAY).toISOString(), "Purge Scheduled");
    const log = vi.spyOn(console, "log");
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "17 9 * * 1" }), env, ctx);
    await waitOnExecutionContext(ctx);
    const lines = log.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.startsWith("slack_join_requests purge"));
    expect(lines).toEqual(["slack_join_requests purge: 1 deleted"]);
    expect(await rowFor("Purge Scheduled")).toBeNull();
  });
});
