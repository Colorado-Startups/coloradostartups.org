// POST /api/waitlist end to end inside workerd (step F1): real D1 with every
// migration applied, Turnstile through MSW (L3's handlers), no notice email,
// one row per email, and the never-fetch rule (BRIEF hard constraint 12).
// Fixtures use example.org and invented names only.
import { createExecutionContext, createScheduledController, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WAITLIST_STAGES } from "../../src/components/founders/waitlist-fields";
import worker from "../../worker/index";
import { handle, purgeWaitlist, WAITLIST_RETENTION_DAYS } from "../../worker/routes/waitlist";
import { expectLimitedBeforeRead, sendBrokenUploads } from "./broken-upload";
import { turnstileAccepting, turnstileDown } from "./l3/turnstile-handlers";
import { burstOver, FORM_LIMIT } from "./rate-limit";
import { server } from "./server";

const BASE = "https://coloradostartups.org";
const ENDPOINT = `${BASE}/api/waitlist`;
const FORM_PAGE = `${BASE}/founders/`;
const THANKS = `${BASE}/founders/waitlist/thanks/`;
const GOOD = "good-token";
let n = 0;

/** Where an error lands: the form's section on /founders/, with the query before the anchor. */
const back = (query: string) => `${FORM_PAGE}?${query}#waitlist`;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (over: Record<string, string> = {}) => {
  n += 1;
  return {
    first_name: "Testa",
    last_name: `Founder ${n}`,
    email: `founder-${n}@example.org`,
    company: `Example Labs ${n}`,
    company_website: "https://example.org/",
    stage: "launch",
    founder: "on",
    ts: String(Date.now() - 10_000),
    "cf-turnstile-response": GOOD,
    ...over,
  };
};

type Row = Record<string, string | number | null>;
const rowFor = (email: string) => env.DB.prepare("SELECT * FROM founders_waitlist WHERE email = ?").bind(email).first<Row>();
const rowsFor = async (email: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM founders_waitlist WHERE email = ?").bind(email).first<{ n: number }>())?.n;

// A FORM_EMAIL binding that records each send, to show the route sends none.
function fakeEmail() {
  const sent: unknown[] = [];
  return { sent, binding: { send: async (message: unknown) => void sent.push(message) } };
}

// Calls the route directly, so a test can swap bindings.
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

describe("POST /api/waitlist", () => {
  it("stores a valid entry, sends no email and redirects to the thanks page", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    const email = fakeEmail();
    const fields = valid();
    const res = await call(fields, { FORM_EMAIL: email.binding as unknown as SendEmail }, "198.51.100.60");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.email)).toMatchObject({
      first_name: "Testa",
      last_name: fields.last_name,
      company: fields.company,
      company_website: "https://example.org/",
      stage: "launch",
      founder: 1,
    });
    expect(email.sent).toHaveLength(0);
    expect(seen[0]?.get("secret")).toBe("test-secret");
    expect(seen[0]?.get("remoteip")).toBe("198.51.100.60");
  });

  it("is routed through the Worker's route table", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid();
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      body: form(fields),
      headers: { "CF-Connecting-IP": "198.51.100.61" },
      redirect: "manual",
    });
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.email)).not.toBeNull();
  });

  it("answers GET with 405", async () => {
    expect((await SELF.fetch(ENDPOINT, { method: "GET" })).status).toBe(405);
  });

  it("keeps one row per email: a second sign-up gets the same thanks page and changes nothing", async () => {
    server.use(turnstileAccepting(GOOD));
    const first = valid();
    expect((await call(first)).headers.get("Location")).toBe(THANKS);
    const again = valid({ email: first.email.toUpperCase(), first_name: "Other", company: "Other Co" });
    expect((await call(again)).headers.get("Location")).toBe(THANKS);
    expect(await rowsFor(first.email)).toBe(1);
    expect(await rowFor(first.email)).toMatchObject({ first_name: "Testa", company: first.company });
  });

  it("stores the email in lower case", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ email: "Mixed.Case@Example.org" });
    expect((await call(fields)).headers.get("Location")).toBe(THANKS);
    expect(await rowFor("mixed.case@example.org")).not.toBeNull();
  });

  it("adds https:// to a website typed without it, and stores a blank website and stage as NULL", async () => {
    server.use(turnstileAccepting(GOOD));
    const typed = valid({ company_website: "example.net" });
    const blank = valid({ company_website: "", stage: "" });
    for (const f of [typed, blank]) expect((await call(f)).headers.get("Location")).toBe(THANKS);
    expect((await rowFor(typed.email))?.company_website).toBe("https://example.net/");
    expect(await rowFor(blank.email)).toMatchObject({ company_website: null, stage: null });
  });

  it.each([
    ["a missing first name", { first_name: "" }, "first_name"],
    ["a missing last name", { last_name: "" }, "last_name"],
    ["a missing email", { email: "" }, "email"],
    ["a bad email", { email: "not-an-email" }, "email"],
    ["a missing company", { company: "" }, "company"],
    ["a company over the cap", { company: "x".repeat(161) }, "company"],
    ["an http website", { company_website: "http://example.org/" }, "company_website"],
    ["a javascript: website", { company_website: "javascript:alert(1)" }, "company_website"],
    ["a website with no dotted host", { company_website: "https://localhost/" }, "company_website"],
    ["a website with a port", { company_website: "https://example.org:8443/" }, "company_website"],
    ["an unknown stage", { stage: "unicorn" }, "stage"],
    ["the support stage, which is no company stage", { stage: "support" }, "stage"],
    ["an unticked founder box", { founder: "" }, "founder"],
  ])("sends %s back with error=invalid naming the field", async (_label, over, field) => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid(over);
    const log = vi.spyOn(console, "log");
    const res = await call(fields);
    expect(res.headers.get("Location")).toBe(back(`field=${field}&error=invalid`));
    // The log names the field, never what was typed.
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(`waitlist: invalid fields ${field}`);
    for (const value of [...Object.values(over), fields.email, fields.last_name]) {
      if (value.length > 3) expect(logged).not.toContain(value);
    }
    expect(await rowFor(fields.email.toLowerCase())).toBeNull();
  });

  it("names every failing field at once, in form order", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ founder: "", first_name: "", company: "" });
    expect((await call(fields)).headers.get("Location")).toBe(
      back("field=first_name&field=company&field=founder&error=invalid"),
    );
  });

  it("answers a filled honeypot with the thanks page and stores nothing", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ website: "https://spam.example" });
    expect((await call(fields)).headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.email)).toBeNull();
  });

  it("sends a post that came too fast back with error=verification", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ ts: String(Date.now()) });
    expect((await call(fields)).headers.get("Location")).toBe(back("error=verification"));
    expect(await rowFor(fields.email)).toBeNull();
  });

  it("refuses a bad Turnstile token and fails closed when Turnstile is down", async () => {
    server.use(turnstileAccepting(GOOD));
    const bad = valid({ "cf-turnstile-response": "forged" });
    expect((await call(bad)).headers.get("Location")).toBe(back("error=verification"));
    expect(await rowFor(bad.email)).toBeNull();

    server.use(turnstileDown());
    const down = valid();
    expect((await call(down)).headers.get("Location")).toBe(back("error=verification"));
    expect(await rowFor(down.email)).toBeNull();
  });

  it("closes the form with error=unavailable when the Turnstile secret is missing", async () => {
    const fields = valid();
    const res = await call(fields, { TURNSTILE_SECRET_KEY: undefined });
    expect(res.headers.get("Location")).toBe(back("error=unavailable"));
    expect(await rowFor(fields.email)).toBeNull();
  });

  it("never fetches the company website", async () => {
    let visits = 0;
    server.use(
      turnstileAccepting(GOOD),
      http.all("https://example.org/*", () => {
        visits += 1;
        return HttpResponse.text("site");
      }),
    );
    expect((await call(valid())).headers.get("Location")).toBe(THANKS);
    expect(visits).toBe(0);
  });

  it("tells the visitor when the row cannot be stored, and logs the failure without the person's details", async () => {
    server.use(turnstileAccepting(GOOD));
    const errors = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");
    const brokenDb = {
      prepare() {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;
    const fields = valid();
    const res = await call(fields, { DB: brokenDb });
    expect(res.headers.get("Location")).toBe(back("error=delivery"));
    const logged = [...errors.mock.calls, ...log.mock.calls].map((c) => c.map(String).join(" "));
    expect(logged.find((l) => l.startsWith("waitlist: insert failed:"))).toBe("waitlist: insert failed: D1 unavailable");
    for (const value of [fields.first_name, fields.last_name, fields.email, fields.company, fields.company_website]) {
      expect(logged.join("\n")).not.toContain(value);
    }
  });

  it("rejects a body over the form byte cap (decision 35)", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ company: "x".repeat(17 * 1024) });
    expect((await call(fields)).headers.get("Location")).toBe(back("error=invalid"));
    expect(await rowFor(fields.email)).toBeNull();
  });

  it("turns away a visitor over the per-IP limit before reading the body", async () => {
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351).
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), ENDPOINT, "192.0.2.206", (req) =>
      handle(req, env, createExecutionContext()),
    );
    expectLimitedBeforeRead(answers, back("error=invalid"), back("error=ratelimit"));
  });
});

// The CHECKs in 0002_founders_waitlist.sql hold the form's rules, so a
// hand-typed statement cannot break them.
describe("the founders_waitlist table's CHECKs", () => {
  let k = 0;
  const insert = (over: Record<string, string | number | null> = {}) => {
    k += 1;
    const row = {
      email: `check-${k}@example.org`,
      company_website: null,
      stage: null,
      founder: 1,
      ...over,
    };
    return env.DB.prepare(
      "INSERT INTO founders_waitlist (created_at, first_name, last_name, email, company, company_website, stage, founder) VALUES ('2026-11-16T00:00:00Z', 'Check', 'Founder', ?, 'Check Co', ?, ?, ?)",
    )
      .bind(row.email, row.company_website, row.stage, row.founder)
      .run();
  };

  it("accepts every stage the form offers, and no stage", async () => {
    for (const stage of [...WAITLIST_STAGES, null]) await insert({ stage });
  });

  it.each([
    ["an unknown stage", { stage: "unicorn" }],
    ["the support stage", { stage: "support" }],
    ["an unticked founder box", { founder: 0 }],
    ["an http website", { company_website: "http://example.org/" }],
    ["an email in capitals", { email: "Caps@example.org" }],
  ])("refuses %s", async (_label, over) => {
    await expect(insert(over)).rejects.toThrow(/CHECK constraint failed/);
  });

  it("refuses a second row with the same email", async () => {
    await insert({ email: "twice@example.org" });
    await expect(insert({ email: "twice@example.org" })).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("stores no IP address", async () => {
    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('founders_waitlist')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name).filter((c) => /ip|addr/i.test(c))).toEqual([]);
  });
});

// Retention (privacy policy, Joining the founders forum waitlist): the weekly
// job deletes each entry 365 days after sign-up, whatever happened.
describe("the weekly founders_waitlist purge", () => {
  const DAY = 86_400_000;
  const NOW = new Date("2026-11-16T12:00:00Z");
  const insert = (createdAt: string, email: string) =>
    env.DB.prepare(
      "INSERT INTO founders_waitlist (created_at, first_name, last_name, email, company, founder) VALUES (?, 'Purge', 'Founder', ?, 'Purge Co', 1)",
    )
      .bind(createdAt, email)
      .run();

  it("keeps 365 days", () => {
    expect(WAITLIST_RETENTION_DAYS).toBe(365);
  });

  it("deletes an entry at 366 days and keeps one at 364", async () => {
    await env.DB.prepare("DELETE FROM founders_waitlist").run();
    await insert(new Date(NOW.getTime() - 366 * DAY).toISOString(), "purge-old@example.org");
    await insert(new Date(NOW.getTime() - 364 * DAY).toISOString(), "purge-recent@example.org");
    expect(await purgeWaitlist(env.DB, NOW)).toBe(1);
    expect(await rowFor("purge-old@example.org")).toBeNull();
    expect(await rowFor("purge-recent@example.org")).not.toBeNull();
    expect(await purgeWaitlist(env.DB, NOW)).toBe(0);
  });

  it("runs in the scheduled handler's RETENTION jobs and logs a count only", async () => {
    await env.DB.prepare("DELETE FROM founders_waitlist").run();
    await insert(new Date(Date.now() - 400 * DAY).toISOString(), "purge-scheduled@example.org");
    const log = vi.spyOn(console, "log");
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "17 9 * * 1" }), env, ctx);
    await waitOnExecutionContext(ctx);
    const lines = log.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.startsWith("founders_waitlist purge"));
    expect(lines).toEqual(["founders_waitlist purge: 1 deleted"]);
    expect(await rowFor("purge-scheduled@example.org")).toBeNull();
  });
});
