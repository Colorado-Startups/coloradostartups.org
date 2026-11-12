// L29g: the two retention jobs that moved from the monthly check into the
// weekly cron, run against real D1 with every migration applied. Each seeds
// rows on both sides of its cutoff, calls the sweep, and checks that only the
// old rows changed. The privacy policy promises both deletions.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import nominationsRunbook from "../../../../ops/runbooks/promote-submissions/nominations.md?raw";
import sweepsRunbook from "../../../../ops/runbooks/promote-submissions/sweeps.md?raw";
import {
  CSP_REPORT_PURGE_SQL,
  CSP_REPORT_RETENTION_DAYS,
  purgeCspReports,
} from "../../../worker/routes/csp-report";
import {
  NOMINATION_RETENTION_DAYS,
  NOMINATION_SWEEP_SQL,
  sweepNominations,
} from "../../../worker/routes/nominate";

// The Nominations and Weekly job sections, each read up to the next "## ".
const runbook = `${nominationsRunbook}\n${sweepsRunbook}`;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const CLEARED = ["base_year_revenue_usd", "current_year_revenue_usd", "fte_headcount", "contact_name", "contact_email"];

/** Every `--command` in the runbook section that opens with `heading`. */
function runbookCommands(heading: string): string[] {
  const start = runbook.indexOf(heading);
  if (start < 0) throw new Error(`runbook has no ${heading}`);
  const text = runbook.slice(start, runbook.indexOf("\n## ", start + 1));
  return [...text.matchAll(/--command "([^"]+)"/g)].map((m) => m[1]!);
}

describe("sweepNominations", () => {
  const payload = (legalName: string) =>
    JSON.stringify({
      legal_name: legalName,
      website: "https://example.org",
      hq_county: "Boulder",
      base_year_revenue_usd: 1_000_000,
      current_year_revenue_usd: 2_000_000,
      fte_headcount: 12,
      contact_name: "Sweep Tester",
      contact_email: "sweep@example.org",
    });
  const insert = (legalName: string, createdAt: string, editionId: string | null = null, deletedAt: string | null = null) =>
    env.DB.prepare(
      "INSERT INTO nominations (created_at, status, payload, edition_id, financials_deleted_at) VALUES (?, 'new', ?, ?, ?)",
    )
      .bind(createdAt, payload(legalName), editionId, deletedAt)
      .run();
  const row = (legalName: string) =>
    env.DB.prepare(
      "SELECT payload, financials_deleted_at FROM nominations WHERE json_extract(payload,'$.legal_name') = ?",
    )
      .bind(legalName)
      .first<{ payload: string; financials_deleted_at: string | null }>();

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM nominations").run();
  });

  it("uses the 180-day limit the privacy policy states", () => {
    expect(NOMINATION_RETENTION_DAYS).toBe(180);
  });

  it("clears unclaimed rows past 180 days and leaves newer, claimed and already-cleared rows alone", async () => {
    await insert("Old Unclaimed", daysAgo(181));
    await insert("Edge Unclaimed", daysAgo(179));
    await insert("Recent Unclaimed", daysAgo(3));
    await insert("Old Claimed", daysAgo(200), "2027-verified");
    await insert("Old Already Cleared", daysAgo(200), null, "2026-01-01 00:00:00");

    expect(await sweepNominations(env.DB)).toBe(1);

    const swept = await row("Old Unclaimed");
    const sweptPayload = JSON.parse(swept!.payload);
    for (const field of CLEARED) expect(sweptPayload, field).not.toHaveProperty(field);
    expect(sweptPayload).toMatchObject({ legal_name: "Old Unclaimed", website: "https://example.org", hq_county: "Boulder" });
    expect(swept!.financials_deleted_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);

    for (const kept of ["Edge Unclaimed", "Recent Unclaimed", "Old Claimed"]) {
      const r = await row(kept);
      expect(JSON.parse(r!.payload), kept).toMatchObject({ current_year_revenue_usd: 2_000_000, contact_email: "sweep@example.org" });
      expect(r!.financials_deleted_at, kept).toBeNull();
    }
    // A row cleared before keeps its first deletion time.
    expect((await row("Old Already Cleared"))!.financials_deleted_at).toBe("2026-01-01 00:00:00");
  });

  it("returns 0 and changes nothing when no row is due", async () => {
    await insert("Recent Unclaimed", daysAgo(3));
    expect(await sweepNominations(env.DB)).toBe(0);
    expect((await row("Recent Unclaimed"))!.financials_deleted_at).toBeNull();
  });

  it("runs the statement the runbook's Nominations step 7 shows for a manual run", () => {
    const manual = runbookCommands("## Nominations (L2)").filter(
      (c) => c.startsWith("UPDATE nominations SET payload = json_remove") && c.includes("edition_id IS NULL"),
    );
    expect(manual).toEqual([NOMINATION_SWEEP_SQL]);
  });
});

describe("purgeCspReports", () => {
  const insert = (signature: string, lastSeen: string) =>
    env.DB.prepare(
      "INSERT INTO csp_reports (signature, directive, blocked_uri, document_uri, count, first_seen, last_seen) VALUES (?, 'script-src', 'https://x.example', '/', 4, ?, ?)",
    )
      .bind(signature, daysAgo(400), lastSeen)
      .run();
  const signatures = async () =>
    (await env.DB.prepare("SELECT signature FROM csp_reports ORDER BY signature").all<{ signature: string }>()).results.map(
      (r) => r.signature,
    );

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM csp_reports").run();
  });

  it("uses the 90-day limit the privacy policy states", () => {
    expect(CSP_REPORT_RETENTION_DAYS).toBe(90);
  });

  it("deletes report types last seen over 90 days ago and keeps newer ones, whatever their first_seen", async () => {
    await insert("old", daysAgo(91));
    await insert("older", daysAgo(300));
    await insert("edge-kept", daysAgo(89));
    await insert("recent", daysAgo(1));

    expect(await purgeCspReports(env.DB)).toBe(2);
    expect(await signatures()).toEqual(["edge-kept", "recent"]);
  });

  it("returns 0 and deletes nothing when no report type is due", async () => {
    await insert("recent", daysAgo(1));
    expect(await purgeCspReports(env.DB)).toBe(0);
    expect(await signatures()).toEqual(["recent"]);
  });

  it("runs the statement the runbook's weekly job shows for a manual run", () => {
    expect(runbookCommands("## Weekly job (Mondays)")).toEqual([CSP_REPORT_PURGE_SQL]);
  });
});
