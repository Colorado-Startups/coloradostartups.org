// L29b: the security-report purge, read from ops/runbooks/promote-submissions/sweeps.md
// and run against the real csp_reports schema. The privacy policy promises it:
// a weekly job deletes each type of report that no browser has sent in the
// last 90 days. L29g moved it from "Monthly check (the 1st)" into "Weekly job
// (Mondays)", where the Worker runs it and the runbook keeps it for a manual run.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import runbook from "../../../../ops/runbooks/promote-submissions/sweeps.md?raw";
import { CSP_REPORT_PURGE_SQL } from "../../../worker/routes/csp-report";

const sectionOf = (heading: string) => {
  const start = runbook.indexOf(heading);
  return start < 0 ? "" : runbook.slice(start, runbook.indexOf("\n## ", start + 1));
};
const commandsIn = (text: string) => [...text.matchAll(/--command "([^"]+)"/g)].map((m) => m[1]!);
const DAY = 86_400_000;

describe("the runbook's monthly check", () => {
  it("has no D1 command left: the only monthly step is the info@ mailbox", () => {
    const monthly = sectionOf("## Monthly check (the 1st)");
    expect(monthly).not.toBe("");
    expect(commandsIn(monthly)).toEqual([]);
  });
});

describe("the runbook's weekly job", () => {
  const commands = commandsIn(sectionOf("## Weekly job (Mondays)"));

  it("has exactly one command, the csp_reports purge the Worker runs", () => {
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBe(CSP_REPORT_PURGE_SQL);
  });

  it("deletes report types last seen over 90 days ago and keeps newer ones", async () => {
    // Written the way worker/routes/csp-report.ts writes them (toISOString).
    const insert = (signature: string, lastSeenDaysAgo: number) => {
      const lastSeen = new Date(Date.now() - lastSeenDaysAgo * DAY).toISOString();
      return env.DB.prepare(
        "INSERT INTO csp_reports (signature, directive, blocked_uri, document_uri, count, first_seen, last_seen) VALUES (?, 'script-src', 'https://x.example', '/', 3, ?, ?)",
      )
        .bind(signature, new Date(Date.now() - 400 * DAY).toISOString(), lastSeen)
        .run();
    };
    await insert("old", 91);
    await insert("edge-kept", 89);
    await insert("recent", 2);

    await env.DB.prepare(commands[0]!).run();

    const kept = await env.DB.prepare("SELECT signature FROM csp_reports ORDER BY signature").all<{ signature: string }>();
    expect(kept.results.map((r) => r.signature)).toEqual(["edge-kept", "recent"]);
  });
});
