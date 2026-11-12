// POST /api/apply end to end inside workerd: real D1 with every migration
// applied, Turnstile through MSW (L3's handlers), the never-fetch rule (BRIEF
// hard constraint 12), and the runbook's own SQL. Fixtures use example.org and
// invented names only.
import { createExecutionContext, createScheduledController, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import runbook from "../../../../ops/runbooks/promote-submissions/applications.md?raw";
import worker from "../../../worker/index";
import { APPLICATION_SWEEP_SQL, handle } from "../../../worker/routes/apply";
import { turnstileAccepting, turnstileDown } from "../l3/turnstile-handlers";
import { expectLimitedBeforeRead, sendBrokenUploads } from "../broken-upload";
import { burstOver, FORM_LIMIT } from "../rate-limit";
import { server } from "../server";

const BASE = "https://coloradostartups.org";
const ENDPOINT = `${BASE}/api/apply`;
const THANKS = `${BASE}/get-involved/apply/thanks/`;
const GOOD = "good-token";
let n = 0;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (over: Record<string, string> = {}) => ({
  role: "space-peak-connector",
  name: `Test Applicant ${++n}`,
  email: "applicant@example.org",
  based_in: "Colorado Springs",
  linkedin: "https://www.linkedin.com/in/test-applicant",
  why: "I go to every founder event in town.\nI want to connect them.",
  "badge_claude-101": "https://academy.claude.com/verify/TEST-0101",
  "badge_ai-fluency-framework-foundations": "https://academy.claude.com/verify/TEST-0102",
  "badge_ai-fluency-for-small-businesses": "https://academy.claude.com/verify/TEST-0103",
  anything_else: "",
  consent: "on",
  ts: String(Date.now() - 10_000),
  "cf-turnstile-response": GOOD,
  ...over,
});

// Each request gets its own visitor IP so the per-IP form limit never trips
// by accident.
async function post(fields: Record<string, string>, ip = `203.0.113.${(n % 250) + 1}`) {
  return SELF.fetch(ENDPOINT, {
    method: "POST",
    body: form(fields),
    headers: { "CF-Connecting-IP": ip },
    redirect: "manual",
  });
}

type Row = Record<string, string | number | null>;
const rowFor = (name: string) => env.DB.prepare("SELECT * FROM applications WHERE name = ?").bind(name).first<Row>();

describe("POST /api/apply", () => {
  it("stores a valid application and redirects to the thanks page", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    const fields = valid();
    const res = await post(fields, "198.51.100.19");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(THANKS);
    const row = await rowFor(fields.name);
    expect(row).toMatchObject({
      status: "new",
      role: "space-peak-connector",
      email: "applicant@example.org",
      based_in: "Colorado Springs",
      linkedin: "https://www.linkedin.com/in/test-applicant",
      why: "I go to every founder event in town.\nI want to connect them.",
      anything_else: null,
      decided_at: null,
      contact_deleted_at: null,
    });
    expect(JSON.parse(String(row?.badges))).toEqual({
      "claude-101": "https://academy.claude.com/verify/TEST-0101",
      "ai-fluency-framework-foundations": "https://academy.claude.com/verify/TEST-0102",
      "ai-fluency-for-small-businesses": "https://academy.claude.com/verify/TEST-0103",
    });
    expect(row?.consent_at).toBe(row?.created_at);
    expect(seen[0]?.get("secret")).toBe("test-secret");
    expect(seen[0]?.get("remoteip")).toBe("198.51.100.19");
  });

  it("never fetches, unfurls or previews a link the applicant sent", async () => {
    let visits = 0;
    server.use(
      turnstileAccepting(GOOD),
      http.all("https://www.linkedin.com/*", () => {
        visits += 1;
        return HttpResponse.text("profile");
      }),
      http.all("https://academy.claude.com/*", () => {
        visits += 1;
        return HttpResponse.text("badge");
      }),
    );
    const fields = valid();
    const ctx = createExecutionContext();
    const request = new Request(ENDPOINT, { method: "POST", body: form(fields), headers: { "CF-Connecting-IP": "192.0.2.61" } });
    const res = await handle(request, env, ctx);
    // waitUntil work (the notice) runs too, so nothing late sneaks past the count.
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.name)).not.toBeNull();
    expect(visits).toBe(0);
  });

  it("stores only the chosen seat's badges", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ "badge_building-effective-human-agent-teams": "https://academy.claude.com/verify/TEST-0104" });
    await post(fields);
    expect(Object.keys(JSON.parse(String((await rowFor(fields.name))?.badges)))).toEqual([
      "claude-101",
      "ai-fluency-framework-foundations",
      "ai-fluency-for-small-businesses",
    ]);
  });

  it("asks the Slack seat for the human-agent teams course", async () => {
    server.use(turnstileAccepting(GOOD));
    const missing = valid({ role: "slack-community-lead" });
    expect((await post(missing)).headers.get("Location")).toBe(`${BASE}/get-involved/apply/?role=slack-community-lead&error=invalid`);
    expect(await rowFor(missing.name)).toBeNull();

    const complete = valid({ role: "slack-community-lead", "badge_building-effective-human-agent-teams": "https://academy.claude.com/verify/TEST-0104" });
    expect((await post(complete)).headers.get("Location")).toBe(THANKS);
    expect(await rowFor(complete.name)).toMatchObject({ role: "slack-community-lead" });
  });

  it("stores an empty LinkedIn and anything else as NULL", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ linkedin: "", anything_else: "" });
    await post(fields);
    expect(await rowFor(fields.name)).toMatchObject({ linkedin: null, anything_else: null });
  });

  it.each([
    ["an http badge link", { "badge_claude-101": "http://academy.claude.com/verify/TEST-0101" }],
    ["a badge link on a lookalike host", { "badge_claude-101": "https://academy.claude.com.evil.example/verify/1" }],
    ["a badge link on another host", { "badge_claude-101": "https://badges.example.org/claude-101/1" }],
    ["a missing badge", { "badge_ai-fluency-for-small-businesses": "" }],
    ["a javascript: LinkedIn link", { linkedin: "javascript:alert(1)" }],
    ["a LinkedIn link on another host", { linkedin: "https://linkedin.com.evil.example/in/x" }],
    ["a link with a password", { linkedin: "https://user:pw@www.linkedin.com/in/x" }],
    ["a missing why", { why: "" }],
    ["a why over the cap", { why: "x".repeat(1501) }],
    ["no consent", { consent: "" }],
    ["a bad email", { email: "not-an-email" }],
  ])("sends %s back with error=invalid and the seat still selected", async (_label, over) => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid(over);
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe(`${BASE}/get-involved/apply/?role=space-peak-connector&error=invalid`);
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("sends an unknown seat back to the plain form, reflecting nothing", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ role: "https://evil.example/" });
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe(`${BASE}/get-involved/apply/?error=invalid`);
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("answers a filled honeypot with the thanks page and stores nothing", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ website: "https://spam.example" });
    expect((await post(fields)).headers.get("Location")).toBe(THANKS);
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("sends a post that came too fast back with error=verification", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ ts: String(Date.now()) });
    expect((await post(fields)).headers.get("Location")).toBe(
      `${BASE}/get-involved/apply/?role=space-peak-connector&error=verification`,
    );
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("rejects a bad Turnstile token and fails closed when Turnstile is down", async () => {
    server.use(turnstileAccepting(GOOD));
    const bad = valid({ "cf-turnstile-response": "forged" });
    expect((await post(bad)).headers.get("Location")).toMatch(/\?role=space-peak-connector&error=verification$/);
    expect(await rowFor(bad.name)).toBeNull();

    server.use(turnstileDown());
    const down = valid();
    expect((await post(down)).headers.get("Location")).toMatch(/&error=verification$/);
    expect(await rowFor(down.name)).toBeNull();
  });

  it("closes the form with error=unavailable when the Turnstile secret is missing", async () => {
    const fields = valid();
    const ctx = createExecutionContext();
    const request = new Request(ENDPOINT, { method: "POST", body: form(fields), headers: { "CF-Connecting-IP": "192.0.2.62" } });
    const res = await handle(request, { ...env, TURNSTILE_SECRET_KEY: undefined }, ctx);
    expect(res.headers.get("Location")).toBe(`${BASE}/get-involved/apply/?role=space-peak-connector&error=unavailable`);
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("tells the applicant when the row cannot be stored", async () => {
    server.use(turnstileAccepting(GOOD));
    const brokenDb = {
      prepare() {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;
    const ctx = createExecutionContext();
    const request = new Request(ENDPOINT, { method: "POST", body: form(valid()), headers: { "CF-Connecting-IP": "192.0.2.63" } });
    const res = await handle(request, { ...env, DB: brokenDb }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Location")).toBe(`${BASE}/get-involved/apply/?role=space-peak-connector&error=delivery`);
  });

  it("parses a multipart body with non-ASCII answers inside the byte cap", async () => {
    server.use(turnstileAccepting(GOOD));
    // 1,500 three-byte characters: 4.5 KB as multipart, 13.5 KB percent-encoded.
    const fields = valid({ why: "金".repeat(1500), anything_else: "é".repeat(1000) });
    expect((await post(fields)).headers.get("Location")).toBe(THANKS);
    expect(String((await rowFor(fields.name))?.why)).toHaveLength(1500);
  });

  it("rejects a body over the form byte cap (decision 35)", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid({ anything_else: "x".repeat(17 * 1024) });
    expect((await post(fields)).headers.get("Location")).toBe(`${BASE}/get-involved/apply/?error=invalid`);
    expect(await rowFor(fields.name)).toBeNull();
  });

  it("turns away a visitor over the per-IP limit before reading the body", async () => {
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351).
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), ENDPOINT, "192.0.2.199", (req) =>
      handle(req, env, createExecutionContext()),
    );
    expectLimitedBeforeRead(answers, `${BASE}/get-involved/apply/?error=invalid`, `${BASE}/get-involved/apply/?error=ratelimit`);
  });

  it("refuses a status outside new, reviewing, accepted and declined", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid();
    await post(fields);
    await expect(
      env.DB.prepare("UPDATE applications SET status = 'acepted' WHERE name = ?").bind(fields.name).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("answers GET with 405", async () => {
    expect((await SELF.fetch(ENDPOINT, { method: "GET" })).status).toBe(405);
  });
});

// The three CHECKs in 0400_applications.sql hold even against a hand-typed
// statement.
describe("the applications table's CHECKs", () => {
  const insert = (role: string, badges: string) =>
    env.DB.prepare(
      "INSERT INTO applications (created_at, role, name, email, based_in, why, badges, consent_at) VALUES ('2026-10-18T00:00:00Z', ?, 'Check Applicant', 'check@example.org', 'Golden', 'why', ?, '2026-10-18T00:00:00Z')",
    )
      .bind(role, badges)
      .run();

  it("refuses a seat outside APPLY_ROLE_IDS", async () => {
    // An old seat id, kept to prove the table refuses it (review item 8).
    await expect(insert("slack-moderator", "{}")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("refuses badges that are not JSON", async () => {
    await expect(insert("space-peak-connector", "not json")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("refuses a decided row that still holds an applicant field", async () => {
    await insert("space-peak-connector", "{}");
    await expect(
      env.DB.prepare("UPDATE applications SET status = 'accepted' WHERE name = 'Check Applicant'").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});

// Retention runs in the Worker's weekly cron (worker/index.ts), so the
// privacy policy's limit does not depend on a person remembering a step.
describe("the weekly applications sweep", () => {
  const insert = (createdAt: string, name: string, status = "new") =>
    env.DB.prepare(
      "INSERT INTO applications (created_at, status, role, name, email, based_in, why, badges, consent_at) VALUES (?, ?, 'fusion-canyon-connector', ?, 'sweep@example.org', 'Greeley', 'why', '{}', ?)",
    )
      .bind(createdAt, status, name, createdAt)
      .run();

  it("declines and clears undecided rows past 180 days, through the scheduled handler", async () => {
    const old = new Date(Date.now() - 181 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 179 * 86_400_000).toISOString();
    await insert(old, "Sweep Old New Applicant");
    await insert(old, "Sweep Old Reviewing Applicant", "reviewing");
    await insert(recent, "Sweep Recent Applicant");

    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "17 9 * * 1" }), env, ctx);
    await waitOnExecutionContext(ctx);

    const swept = await env.DB.prepare("SELECT * FROM applications WHERE created_at = ? AND role = 'fusion-canyon-connector'")
      .bind(old)
      .all<Row>();
    expect(swept.results).toHaveLength(2);
    for (const row of swept.results) {
      expect(row).toMatchObject({ status: "declined", name: null, email: null, why: null, badges: null });
      expect(row.contact_deleted_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
    expect(await rowFor("Sweep Recent Applicant")).toMatchObject({ status: "new", email: "sweep@example.org" });
  });

  it("shows Paul the exact statement the Worker runs", () => {
    const section = runbook.slice(runbook.indexOf("## Applications (L19)"));
    const manual = [...section.matchAll(/--command "([^"]+)"/g)]
      .map((m) => m[1]!)
      .find((c) => c.startsWith("UPDATE applications SET status = 'declined'"));
    expect(manual).toBe(APPLICATION_SWEEP_SQL);
  });
});

// The commands in ops/runbooks/promote-submissions/applications.md, read from
// the runbook itself. The privacy policy promises the deletion, so the exact
// statements Paul copies are proven here against D1.
describe("the runbook's Applications commands", () => {
  const section = runbook.slice(runbook.indexOf("## Applications (L19)"));
  const commands = [...section.matchAll(/--command "([^"]+)"/g)].map((m) => m[1]!);
  const find = (start: string) => {
    const sql = commands.find((c) => c.startsWith(start));
    if (!sql) throw new Error(`runbook has no command starting ${start}`);
    return sql;
  };
  const APPLICANT = ["name", "email", "based_in", "linkedin", "why", "badges", "anything_else"];

  it("has the read, review, decide, sweep and confirm commands", () => {
    expect(commands).toHaveLength(5);
  });

  it("reads open applications, then marks one reviewing", async () => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid();
    await post(fields);
    const id = (await rowFor(fields.name))!.id;
    const read = await env.DB.prepare(find("SELECT id, created_at, status, role")).all<Row>();
    expect(read.results.map((r) => r.id)).toContain(id);

    await env.DB.prepare(find("UPDATE applications SET status = 'reviewing'").replace("id = 42", `id = ${id}`)).run();
    expect((await rowFor(fields.name))?.status).toBe("reviewing");
  });

  it.each(["accepted", "declined"])("records %s and deletes every applicant field in one command", async (status) => {
    server.use(turnstileAccepting(GOOD));
    const fields = valid();
    await post(fields);
    const id = (await rowFor(fields.name))!.id;
    const decide = find("UPDATE applications SET status = 'accepted'")
      .replace("status = 'accepted'", `status = '${status}'`)
      .replace("id = 42", `id = ${id}`);
    await env.DB.prepare(decide).run();

    const row = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first<Row>();
    expect(row).toMatchObject({ status, role: "space-peak-connector" });
    for (const col of APPLICANT) expect(row?.[col], col).toBeNull();
    expect(row?.decided_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(row?.contact_deleted_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("sweeps undecided rows older than 180 days, and the confirm count is 0", async () => {
    const insert = (createdAt: string, name: string) =>
      env.DB.prepare(
        "INSERT INTO applications (created_at, status, role, name, email, based_in, why, badges, consent_at) VALUES (?, 'new', 'space-peak-connector', ?, 'applicant@example.org', 'Colorado Springs', 'why', '{}', ?)",
      )
        .bind(createdAt, name, createdAt)
        .run();
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await insert(old, "Old Applicant");
    await insert(recent, "Recent Applicant");

    await env.DB.prepare(find("UPDATE applications SET status = 'declined'")).run();
    const swept = await env.DB.prepare("SELECT * FROM applications WHERE created_at = ?").bind(old).first<Row>();
    expect(swept).toMatchObject({ status: "declined", name: null, email: null });
    expect(await rowFor("Recent Applicant")).toMatchObject({ status: "new", email: "applicant@example.org" });

    const confirm = await env.DB.prepare(find("SELECT COUNT(*) AS kept")).first<{ kept: number }>();
    expect(confirm?.kept).toBe(0);
  });
});
