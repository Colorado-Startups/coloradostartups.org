// L29b: the privacy policy's new statements against the code they describe.
// If one of these fails, the code changed under a promise in
// data/legal/privacy.md. Fix the code or change the policy in the same PR.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CompanySchema } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { IN_ARCHIVE } from "../../archive";

// @ts-expect-error plain .mjs ops module without type declarations
import { readMap } from "../../../../ops/redirects/map.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(SITE, rel), "utf8");
const POLICY = read("../data/legal/privacy.md");

/** The paragraph that opens with a bold label, up to the next bold label or heading. */
function section(label: string): string {
  const start = POLICY.indexOf(`**${label}.**`);
  if (start < 0) return "";
  const rest = POLICY.slice(start + label.length + 5);
  const end = rest.search(/\n(\*\*[^*]+\.\*\*|## )/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** "name, website, sector, HQ city and a revenue range" as a list. */
const fieldList = (s: string) =>
  s
    .split(/,\s*|\s+and\s+/)
    .map((f) => f.trim())
    .filter(Boolean);

describe("Leaderboard nominations", () => {
  it("the policy and the form's consent box name the same published fields", () => {
    const policy = POLICY.match(/we may publish its ([^.]+?), as you agreed on the form/)?.[1];
    const form = read("src/components/leaderboard/NominationForm.astro").match(
      /may publish the company's ([^.]+?) if it is listed/,
    )?.[1];
    expect(policy, "policy sentence").toBeTruthy();
    expect(form, "consent label").toBeTruthy();
    expect(fieldList(policy!)).toEqual(fieldList(form!));
    expect(fieldList(policy!)).toContain("HQ city");
  });

  it("a listed company carries an HQ city and no county, as the policy says", () => {
    const keys = Object.keys(CompanySchema.shape);
    expect(keys).toContain("hq_city");
    expect(keys.filter((k) => /county/i.test(k))).toEqual([]);
    expect(read("src/components/leaderboard/HonoreesTable.astro")).toContain('label: "HQ city"');
    expect(section("Leaderboard nominations")).toContain("the Leaderboard does not show it");
  });

  it("the notice email to Paul never carries the nominator's name or email", () => {
    const route = read("worker/routes/nominate.ts");
    const call = route.slice(route.indexOf("notify("), route.lastIndexOf("return redirect(url, NOMINATE_THANKS_PATH)"));
    expect(call).toContain("legal_name");
    expect(call).not.toMatch(/contact_(name|email)/);
  });

  it("every day count the policy adds for nominator details carries its source", () => {
    const lines = section("Leaderboard nominations")
      .split("\n")
      .filter((l) => /name and email|your name and your email|restore points/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) {
      for (const sentence of line.split(/(?<=[.)])\s+(?=[A-Z])/)) {
        if (/\d+ days/.test(sentence)) expect(sentence).toMatch(/\(our commitment\)|documentation, read \d{4}-\d{2}-\d{2}/);
      }
    }
  });
});

describe("Joining the Slack", () => {
  it("the Slack backend is a Google Form, and the policy says so", () => {
    // The form's URL lives in the /slack row of the redirect map (#128).
    const url = new URL(readMap().find((r: { old: string }) => r.old === "/slack").to);
    expect(url.hostname).toBe("docs.google.com");
    expect(url.pathname.startsWith("/forms/")).toBe(true);
    const slack = section("Joining our Slack");
    expect(slack).toContain("Google Form");
    expect(slack).toContain("Google hosts the form");
    expect(POLICY).toMatch(/\| Google \|[^\n]*Google Forms/);
  });

  // Nothing in the repo records who owns the form or where its answers go, so
  // the policy promises nothing about them until Paul confirms (PR #82 review).
  it("makes no promise about the form's answers", () => {
    const slack = section("Joining our Slack").trim();
    expect(slack).toBe("Joining starts with a short Google Form. Google hosts the form, and Google's privacy policy covers your visit to it. The form says what it asks for and why.");
  });
});

describe("Security reports", () => {
  it("csp_reports stores only the fields the policy lists, and no IP", () => {
    const migrations = readdirSync(path.join(SITE, "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => read(`migrations/${f}`))
      .join("\n");
    const table = migrations.match(/CREATE TABLE IF NOT EXISTS csp_reports \(([\s\S]*?)\n\);/)?.[1];
    expect(table, "csp_reports table").toBeTruthy();
    const columns = table!
      .split("\n")
      .map((l) => l.trim().match(/^([a-z_]+)\s/)?.[1])
      .filter(Boolean);
    expect(columns).toEqual(["signature", "directive", "blocked_uri", "document_uri", "count", "first_seen", "last_seen"]);
    expect(migrations).not.toMatch(/ALTER TABLE csp_reports/i);
    const policy = POLICY.match(/\*\*Security reports\.\*\*[^\n]*/)?.[0] ?? "";
    expect(policy).toContain("with no IP address");
    expect(policy).toContain("(our commitment)");
  });
});

describe("Request logs", () => {
  const wrangler = read("wrangler.jsonc");
  const logs = POLICY.match(/\*\*Request logs\.\*\*[^\n]*/)?.[0] ?? "";

  it("while Workers Logs is on, the policy says the logs hold your IP address and for how long", () => {
    if (/"observability":\s*\{\s*"enabled":\s*true/.test(wrangler)) {
      expect(logs).toContain("which include your IP address");
      expect(logs).toMatch(/up to \d+ days \(Cloudflare's Workers Logs documentation, read \d{4}-\d{2}-\d{2}\)/);
      expect(POLICY).toContain("We do not store it with anything you send.");
      expect(POLICY).not.toMatch(/one connection\. We do not store it\.\s/);
    } else {
      expect(logs, "turned off: update the Request logs bullet").toBe("");
    }
  });

  it("names the requests that reach the Worker, which run_worker_first sets to /api/ only", () => {
    expect(wrangler).toMatch(/"run_worker_first":\s*\["\/api\/\*"\]/);
    expect(logs).toContain("every address under `/api/`");
    expect(logs).toContain("Requests for our pages and files skip it");
  });
});

// The runbooks are under ops/, which the public export leaves out.
describe.skipIf(!IN_ARCHIVE)("the monthly check", () => {
  const runbook = IN_ARCHIVE ? read("../ops/runbooks/promote-submissions/sweeps.md") : "";
  const runbookSection = (heading: string) => {
    const start = runbook.indexOf(heading);
    expect(start, heading).toBeGreaterThan(-1);
    return runbook.slice(start, runbook.indexOf("\n## ", start + 1));
  };

  it("the runbook lists a step for every promise the policy makes at our monthly check", () => {
    const steps = runbookSection("## Monthly check (the 1st)");
    expect(section("Messages to us")).toMatch(/monthly check/);
    expect(steps).toContain("info@coloradostartups.org");
    // L29g moved the nomination sweep and the csp_reports purge into the
    // weekly job. One promise in the policy, one step in the runbook, no more.
    expect(POLICY.match(/monthly check/g)).toHaveLength(1);
    expect(steps.match(/^\d+\. \*\*/gm)).toHaveLength(1);
    expect(steps).not.toContain("--command");
  });

  it("unclaimed nominations and security reports name the weekly job, and the runbook's weekly job lists both", () => {
    expect(section("Leaderboard nominations")).toContain("a weekly job deletes the figures, your name and your email");
    expect(POLICY.match(/\*\*Security reports\.\*\*[^\n]*/)?.[0]).toContain("A weekly job deletes each type of report");
    const weekly = runbookSection("## Weekly job (Mondays)");
    expect(weekly).toContain("Nominations step 7");
    expect(weekly).toContain("DELETE FROM csp_reports");
  });

  it("declining a nomination clears it at once, and the runbook's decline does that", () => {
    expect(section("Leaderboard nominations")).toContain(
      "If we decline your nomination, we delete the figures, your name and your email when we decide (our commitment).",
    );
    const runbook = read("../ops/runbooks/promote-submissions/nominations.md");
    expect(runbook).toContain(
      `UPDATE nominations SET status = 'declined', payload = json_remove(payload,'$.base_year_revenue_usd','$.current_year_revenue_usd','$.fte_headcount','$.contact_name','$.contact_email'), financials_deleted_at = datetime('now') WHERE id = 42`,
    );
  });
});

describe("Messages to us", () => {
  it("states a period for conversations, marked as our commitment", () => {
    expect(section("Messages to us")).toMatch(
      /we delete each conversation whose last message is more than \d+ months old \(our commitment\)\./,
    );
  });
});
