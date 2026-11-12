import { createExecutionContext, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { handle, NOMINATION_SWEEP_SQL } from "../../../worker/routes/nominate";
import { expectLimitedBeforeRead, sendBrokenUploads } from "../broken-upload";
import { burstOver, FORM_LIMIT } from "../rate-limit";
import { server } from "../server";
import { turnstileFails, turnstilePasses } from "./handlers";

// ops/ is private: the public export leaves the runbook out, so the glob finds
// nothing there and the tests that read it skip. (The workerd pool has no
// real file system, so this checks the glob, not the archive marker.)
const runbook = Object.values(import.meta.glob<string>("../../../../ops/runbooks/promote-submissions/nominations.md", { query: "?raw", import: "default", eager: true }))[0] ?? "";
const HAVE_RUNBOOK = runbook !== "";

// The Nominations commands Paul copies from ops/runbooks/promote-submissions/nominations.md,
// read from the runbook itself so the tests below prove the exact statements.
// The section ends at the next "## " heading, whatever follows it.
const NOMINATIONS_START = runbook.indexOf("## Nominations (L2)");
const NOMINATION_COMMANDS = [
  ...runbook.slice(NOMINATIONS_START, runbook.indexOf("\n## ", NOMINATIONS_START + 1)).matchAll(/--command "([^"]+)"/g),
].map((m) => m[1]!);
function runbookSql(start: string, contains: string): string {
  const sql = NOMINATION_COMMANDS.find((c) => c.startsWith(start) && c.includes(contains));
  if (!sql && !HAVE_RUNBOOK) return "";
  if (!sql) throw new Error(`runbook has no Nominations command starting ${start} with ${contains}`);
  return sql;
}
const DECLINE_SQL = runbookSql("UPDATE nominations SET status = 'declined'", "WHERE id = 42");
const STEP_6_SQL = runbookSql("UPDATE nominations SET payload = json_remove", "edition_id = '2027-verified'");
const STEP_6_CONFIRM_SQL = runbookSql("SELECT COUNT(*) FROM nominations", "edition_id = '2027-verified'");
const STEP_7_SQL = runbookSql("UPDATE nominations SET payload = json_remove", "edition_id IS NULL");

const URL_ = "https://coloradostartups.org/api/nominate";
const FORM_PAGE = "https://coloradostartups.org/leaderboard/nominate/";
const THANKS = "https://coloradostartups.org/leaderboard/nominate/thanks/";

// Each test gets its own visitor IP, so the per-IP rate limit never carries
// over from one test to the next.
let ipSeq = 0;
const nextIp = () => `203.0.113.${++ipSeq}`;

function validFields(): Record<string, string> {
  return {
    legal_name: "Example Robotics, Inc.",
    company_website: "https://example.com",
    hq_city: "Boulder",
    hq_county: "Boulder",
    founded_year: "2019",
    private_independent_for_profit: "on",
    base_year: "2022",
    base_year_revenue_usd: "$1,200,000",
    current_year_revenue_usd: "4800000",
    fte_headcount: "32",
    sector: "Hardware and robotics",
    contact_name: "Sam Founder",
    contact_email: "sam@example.com",
    consent_to_publish: "on",
    attestation: "on",
    ts: String(Date.now() - 10_000),
    "cf-turnstile-response": "token",
    return_to: "/leaderboard/nominate/",
  };
}

function formBody(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return body;
}

function post(fields: Record<string, string>, ip = nextIp()) {
  return SELF.fetch(URL_, {
    method: "POST",
    body: formBody(fields),
    headers: { "CF-Connecting-IP": ip },
    redirect: "manual",
  });
}

// For cases that need a broken binding, the handler is called directly.
const request = (fields: Record<string, string>) =>
  new Request(URL_, { method: "POST", body: formBody(fields), headers: { "CF-Connecting-IP": nextIp() } });

const rowCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM nominations").first<{ n: number }>())?.n ?? 0;

describe("POST /api/nominate", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM nominations").run();
  });

  it("stores a valid nomination and sends the visitor to the thank-you page", async () => {
    server.use(turnstilePasses());
    const res = await post(validFields());
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(THANKS);

    const row = await env.DB.prepare("SELECT status, payload, edition_id FROM nominations").first<{
      status: string;
      payload: string;
      edition_id: string | null;
    }>();
    expect(row?.status).toBe("new");
    expect(row?.edition_id).toBeNull();
    const payload = JSON.parse(row!.payload);
    expect(payload.website).toBe("https://example.com");
    expect(payload.base_year_revenue_usd).toBe(1_200_000);
    expect(payload.private_independent_for_profit).toBe(true);
    // Only NominationSchema fields are stored: no honeypot, stamp or token.
    expect(Object.keys(payload).sort()).toEqual(
      [
        "attestation",
        "base_year",
        "base_year_revenue_usd",
        "consent_to_publish",
        "contact_email",
        "contact_name",
        "current_year_revenue_usd",
        "founded_year",
        "fte_headcount",
        "hq_city",
        "hq_county",
        "legal_name",
        "private_independent_for_profit",
        "sector",
        "website",
      ].sort(),
    );
  });

  it("answers a filled honeypot with the thank-you page and stores nothing", async () => {
    const res = await post({ ...validFields(), website: "https://spam.example" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(THANKS);
    expect(await rowCount()).toBe(0);
  });

  it("rejects a post with no load stamp", async () => {
    const { ts: _ts, ...noStamp } = validFields();
    const res = await post(noStamp);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=verification`);
    expect(await rowCount()).toBe(0);
  });

  it("rejects a post made faster than a person can fill the form", async () => {
    const res = await post({ ...validFields(), ts: String(Date.now() - 500) });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=verification`);
  });

  // #132: the Location names the form field to fix, from a fixed list.
  it.each([
    ["a missing legal name", { legal_name: "" }, "legal_name"],
    ["a website that is not http(s)", { company_website: "javascript:alert(1)" }, "company_website"],
    ["a county outside Colorado", { hq_county: "Los Angeles" }, "hq_county"],
    ["a sector not on the list", { sector: "Crypto moonshots" }, "sector"],
    ["revenue written in words", { base_year_revenue_usd: "two million" }, "base_year_revenue_usd"],
    ["revenue as 1.2M", { base_year_revenue_usd: "1.2M" }, "base_year_revenue_usd"],
    ["negative revenue", { current_year_revenue_usd: "-5" }, "current_year_revenue_usd"],
    ["a fractional headcount", { fte_headcount: "3.5" }, "fte_headcount"],
    ["a missing HQ city", { hq_city: "" }, "hq_city"],
    ["a founding date where the year goes", { founded_year: "2019-04-01" }, "founded_year"],
    ["a founding year in the future", { founded_year: String(new Date().getUTCFullYear() + 1) }, "founded_year"],
    ["a base year in the future", { base_year: String(new Date().getUTCFullYear() + 1) }, "base_year"],
    ["a malformed contact email", { contact_email: "sam at example" }, "contact_email"],
  ])("rejects %s and names the field", async (_label, override, field) => {
    server.use(turnstilePasses());
    const res = await post({ ...validFields(), ...override });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=${field}&error=invalid`);
    expect(await rowCount()).toBe(0);
  });

  it("names every field to fix, in form order, and nothing the visitor typed", async () => {
    server.use(turnstilePasses());
    const res = await post({ ...validFields(), contact_email: "<script>", legal_name: "", base_year_revenue_usd: "lots" });
    expect(res.headers.get("Location")).toBe(
      `${FORM_PAGE}?field=legal_name&field=base_year_revenue_usd&field=contact_email&error=invalid`,
    );
  });

  // #138: a bare address is stored with https:// in front.
  it("accepts a website typed without https://", async () => {
    server.use(turnstilePasses());
    const res = await post({ ...validFields(), company_website: "example.com" });
    expect(res.headers.get("Location")).toBe(THANKS);
    const row = await env.DB.prepare("SELECT payload FROM nominations").first<{ payload: string }>();
    expect(JSON.parse(row?.payload ?? "{}").website).toBe("https://example.com");
  });

  it.each([
    "private_independent_for_profit",
    "consent_to_publish",
    "attestation",
  ])("rejects a post without the %s box checked", async (box) => {
    const fields = validFields();
    delete fields[box];
    const res = await post(fields);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=${box}&error=invalid`);
    expect(await rowCount()).toBe(0);
  });

  it("rejects a failed Turnstile check", async () => {
    server.use(turnstileFails());
    const res = await post(validFields());
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=verification`);
    expect(await rowCount()).toBe(0);
  });

  it("returns errors to an allowlisted page only", async () => {
    const res = await post({ ...validFields(), legal_name: "", return_to: "https://evil.example/" });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=legal_name&error=invalid`);
    const back = await post({ ...validFields(), legal_name: "", return_to: "/leaderboard/" });
    expect(back.headers.get("Location")).toBe("https://coloradostartups.org/leaderboard/?field=legal_name&error=invalid");
  });

  it("rejects an oversized chunked body with no Content-Length and stores nothing", async () => {
    server.use(turnstilePasses());
    // A valid form, padded far past MAX_FORM_BYTES, streamed in chunks so no
    // Content-Length header can announce the size.
    const fields = new URLSearchParams({ ...validFields(), legal_name: "Example Robotics, Inc." });
    const chunk = new TextEncoder().encode("&pad=" + "x".repeat(64 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) controller.enqueue(new TextEncoder().encode(fields.toString()));
        else if (sent <= 128) controller.enqueue(chunk);
        else controller.close();
        sent++;
      },
    });
    const req = new Request(URL_, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": nextIp() },
      // @ts-expect-error duplex is required for a streamed request body
      duplex: "half",
      redirect: "manual",
    });
    expect(req.headers.get("Content-Length")).toBeNull();
    const res = await SELF.fetch(req);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=invalid`);
    expect(await rowCount()).toBe(0);
  });

  it("rejects a website longer than the schema allows", async () => {
    server.use(turnstilePasses());
    const res = await post({ ...validFields(), company_website: `https://example.com/${"a".repeat(2100)}` });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?field=company_website&error=invalid`);
    expect(await rowCount()).toBe(0);
  });

  it("rejects a body that is not a form", async () => {
    const res = await SELF.fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
      body: "{}",
      redirect: "manual",
    });
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=invalid`);
  });

  it("refuses everything when the Turnstile secret is missing", async () => {
    const ctx = createExecutionContext();
    const res = await handle(request(validFields()), { ...env, TURNSTILE_SECRET_KEY: undefined }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=unavailable`);
    expect(await rowCount()).toBe(0);
  });

  it("reports a failed insert instead of claiming success", async () => {
    server.use(turnstilePasses());
    const brokenDb = {
      prepare() {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;
    const ctx = createExecutionContext();
    const res = await handle(request(validFields()), { ...env, DB: brokenDb }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Location")).toBe(`${FORM_PAGE}?error=delivery`);
  });

  // The decline statement in ops/runbooks/promote-submissions/nominations.md, step 2, read
  // from the runbook. The privacy policy promises that declining deletes the
  // figures and the nominator's contact when we decide, so step 7 never has to.
  it.skipIf(!HAVE_RUNBOOK)("the runbook's decline deletes revenue, headcount and the nominator's contact at once, for that row only", async () => {
    server.use(turnstilePasses());
    await post(validFields());
    await env.DB.prepare("UPDATE nominations SET id = 42").run();
    await post(validFields());
    await env.DB.prepare(DECLINE_SQL).run();
    const rows = await env.DB.prepare("SELECT id, status, payload, financials_deleted_at FROM nominations ORDER BY id").all<{
      id: number;
      status: string;
      payload: string;
      financials_deleted_at: string | null;
    }>();
    expect(rows.results).toHaveLength(2);
    const declined = rows.results.find((r) => r.id === 42);
    const other = rows.results.find((r) => r.id !== 42);
    const payload = JSON.parse(declined!.payload);
    expect(declined!.status).toBe("declined");
    for (const field of ["base_year_revenue_usd", "current_year_revenue_usd", "fte_headcount", "contact_name", "contact_email"]) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(payload.legal_name).toBe("Example Robotics, Inc.");
    expect(declined!.financials_deleted_at).not.toBeNull();
    expect(other!.status).toBe("new");
    expect(JSON.parse(other!.payload).contact_email).toBe(validFields().contact_email);
    expect(other!.financials_deleted_at).toBeNull();
  });

  // The SQL in ops/runbooks/promote-submissions/nominations.md, step 6, read from the
  // runbook. The privacy policy promises this deletion, so the statement is
  // proven here against D1.
  it.skipIf(!HAVE_RUNBOOK)("the runbook's 90-day deletion removes revenue, headcount and the nominator's contact, and keeps the rest", async () => {
    server.use(turnstilePasses());
    await post(validFields());
    await env.DB.prepare("UPDATE nominations SET status = 'verified', edition_id = '2027-verified'").run();
    const before = await env.DB.prepare(STEP_6_CONFIRM_SQL).first<number>("COUNT(*)");
    expect(before).toBe(1);
    await env.DB.prepare(STEP_6_SQL).run();
    const row = await env.DB.prepare("SELECT payload, financials_deleted_at FROM nominations").first<{
      payload: string;
      financials_deleted_at: string | null;
    }>();
    const payload = JSON.parse(row!.payload);
    for (const field of ["base_year_revenue_usd", "current_year_revenue_usd", "fte_headcount", "contact_name", "contact_email"]) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(payload.legal_name).toBe("Example Robotics, Inc.");
    expect(payload.hq_county).toBe("Boulder");
    expect(row!.financials_deleted_at).not.toBeNull();
    // The runbook's confirm query must then count 0.
    expect(await env.DB.prepare(STEP_6_CONFIRM_SQL).first<number>("COUNT(*)")).toBe(0);
  });

  // Runbook steps 3 and 7: no row keeps its revenue or its nominator's
  // contact forever, reviewed or not. Step 7 is the statement the weekly job
  // runs (sweepNominations), so the manual copy must match it exactly.
  it.skipIf(!HAVE_RUNBOOK)("step 7 in the runbook is the statement the weekly job runs", () => {
    expect(STEP_7_SQL).toBe(NOMINATION_SWEEP_SQL);
  });

  it.skipIf(!HAVE_RUNBOOK)("step 3 assigns unreviewed rows before the cutoff, and step 7 sweeps old unassigned rows", async () => {
    const payload = JSON.stringify({
      legal_name: "X",
      base_year_revenue_usd: 1,
      current_year_revenue_usd: 2,
      fte_headcount: 3,
      contact_name: "Sam Founder",
      contact_email: "sam@example.com",
    });
    const insert = (createdAt: string, status: string) =>
      env.DB.prepare("INSERT INTO nominations (created_at, status, payload) VALUES (?, ?, ?)")
        .bind(createdAt, status, payload)
        .run();
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await insert("2027-01-15T00:00:00.000Z", "new");
    await insert("2027-02-01T00:00:00.000Z", "verifying");
    await insert("2027-04-01T00:00:00.000Z", "new"); // after the cutoff
    await insert(old, "new");
    await insert(recent, "new");

    await env.DB.prepare(
      "UPDATE nominations SET edition_id = '2027-verified' WHERE edition_id IS NULL AND created_at < '2027-03-01T00:00:00Z'",
    ).run();
    const assigned = await env.DB.prepare("SELECT created_at FROM nominations WHERE edition_id = '2027-verified' ORDER BY created_at").all<{ created_at: string }>();
    // The two pre-cutoff 2027 rows, plus the old and recent rows (also before the cutoff).
    expect(assigned.results.map((r) => r.created_at)).toContain("2027-01-15T00:00:00.000Z");
    expect(assigned.results.map((r) => r.created_at)).toContain("2027-02-01T00:00:00.000Z");
    expect(assigned.results.map((r) => r.created_at)).not.toContain("2027-04-01T00:00:00.000Z");

    // Sweep: unassign the old and recent rows to test step 7 on its own.
    await env.DB.prepare("UPDATE nominations SET edition_id = NULL WHERE created_at IN (?, ?)").bind(old, recent).run();
    await env.DB.prepare(STEP_7_SQL).run();
    const rows = await env.DB.prepare("SELECT created_at, payload, financials_deleted_at FROM nominations").all<{
      created_at: string;
      payload: string;
      financials_deleted_at: string | null;
    }>();
    const byDate = new Map(rows.results.map((r) => [r.created_at, r]));
    const swept = JSON.parse(byDate.get(old)!.payload);
    expect(swept).not.toHaveProperty("current_year_revenue_usd");
    expect(swept).not.toHaveProperty("contact_name");
    expect(swept).not.toHaveProperty("contact_email");
    expect(swept.legal_name).toBe("X");
    expect(byDate.get(old)!.financials_deleted_at).not.toBeNull();
    expect(JSON.parse(byDate.get(recent)!.payload).current_year_revenue_usd).toBe(2);
    expect(JSON.parse(byDate.get(recent)!.payload).contact_email).toBe("sam@example.com");
    expect(JSON.parse(byDate.get("2027-04-01T00:00:00.000Z")!.payload).current_year_revenue_usd).toBe(2);
  });

  it("rate-limits a visitor before reading the body", async () => {
    // FORM_RATE_LIMIT allows 10 posts per 60 s per IP per route (wrangler.jsonc).
    // burstOver sends enough to trip it even across a window edge (#339).
    // Every body breaks off mid-read (broken-upload.ts). Posts under the limit
    // are read and answered invalid; posts over it must be answered ratelimit
    // with the body never read (#351).
    const answers = await sendBrokenUploads(burstOver(FORM_LIMIT), URL_, nextIp(), (req) => handle(req, env, createExecutionContext()));
    expectLimitedBeforeRead(answers, `${FORM_PAGE}?error=invalid`, `${FORM_PAGE}?error=ratelimit`);
  });
});
