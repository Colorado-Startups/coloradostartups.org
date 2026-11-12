// L29g: the privacy policy's weekly-job and Turnstile sentences against the
// code they describe. If one of these fails, the code changed under a promise
// in data/legal/privacy.md. Fix the code or change the policy in the same PR.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IN_ARCHIVE } from "../../archive";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(SITE, rel), "utf8");
const POLICY = read("../data/legal/privacy.md");
const bullet = (label: string) => POLICY.match(new RegExp(`\\*\\*${label}\\.\\*\\*[^\\n]*`))?.[0] ?? "";
const constant = (file: string, name: string) => Number(read(file).match(new RegExp(`export const ${name} = (\\d+);`))?.[1]);

/** Every file under `dir` (relative to site/), recursively. */
function filesUnder(dir: string): string[] {
  const abs = path.join(SITE, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(SITE, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

describe("Bot protection: Turnstile receives your IP address", () => {
  const turnstile = read("worker/lib/turnstile.ts");
  const bot = bullet("Bot protection");
  const FROM_US = "and from us when we confirm the result";
  const FROM_BROWSER = "Turnstile receives your IP address from your browser when the check runs";

  it("says we send it exactly when worker/lib/turnstile.ts sends remoteip to siteverify", () => {
    const sendsIp = /body\.append\("remoteip",\s*ip\)/.test(turnstile);
    // Removing the remoteip line without the sentence, or the sentence without
    // the line, fails here. Removing both together passes, as it should.
    expect(bot.includes(FROM_US), "policy sentence matches turnstile.ts").toBe(sendsIp);
  });

  it("says the browser sends it while a page loads the widget from challenges.cloudflare.com", () => {
    const widget = filesUnder("src")
      .filter((f) => /\.(astro|ts|mjs)$/.test(f))
      .filter((f) => read(f).includes("https://challenges.cloudflare.com/turnstile/v0/api.js"));
    expect(bot.includes(FROM_BROWSER), "policy sentence matches the widget").toBe(widget.length > 0);
  });

  it("cites the doc and its read date in the sentence that says what Cloudflare does with it", () => {
    expect(bot).toMatch(
      /Cloudflare uses it to tell people from bots and to improve its bot detection, not to identify, profile or target you \(Cloudflare's Turnstile Privacy Addendum, read \d{4}-\d{2}-\d{2}\)\./,
    );
  });

  it("names every Worker route that checks Turnstile: the forms and the Resourcus question box", () => {
    // The form routes check it through turnstileError() in worker/lib/forms.ts,
    // which must call verifyTurnstile. ask.ts calls verifyTurnstile itself.
    const forms = read("worker/lib/forms.ts");
    const start = forms.indexOf("export async function turnstileError(");
    expect(start, "worker/lib/forms.ts defines turnstileError").toBeGreaterThanOrEqual(0);
    expect(forms.slice(start, forms.indexOf("\n}\n", start)), "turnstileError calls verifyTurnstile").toContain("verifyTurnstile(");
    const checks = /\b(?:verifyTurnstile|turnstileError)\(/;
    const routes = filesUnder("worker/routes").filter((f) => checks.test(read(f)));
    expect(routes.map((f) => path.basename(f)).sort()).toEqual(
      ["apply.ts", "ask.ts", "nominate.ts", "subscribe.ts", "suggest-resource.ts"],
    );
    expect(bot).toContain("Our forms and the Resourcus question box use Cloudflare Turnstile");
  });
});

describe("the weekly job", () => {
  const index = read("worker/index.ts");
  const scheduled = index.slice(index.indexOf("async scheduled("));
  const tableStart = index.indexOf("const RETENTION");
  const retention = tableStart < 0 ? "" : index.slice(tableStart, index.indexOf("\n];\n", tableStart));
  const wrangler = read("wrangler.jsonc");

  it("scheduled() runs the nomination sweep and the security-report purge the policy promises", () => {
    // The jobs sit in the RETENTION table; scheduled() runs each one on env.DB.
    expect(retention, "worker/index.ts declares the RETENTION table").not.toBe("");
    expect(retention).toContain("sweepNominations(db)");
    expect(retention).toContain("purgeCspReports(db)");
    expect(scheduled).toMatch(/for \(const \[label, job\] of RETENTION\)/);
    expect(scheduled).toContain("job(env.DB)");
  });

  it("every environment in wrangler.jsonc has a cron that runs at least weekly", () => {
    const lists = [...wrangler.matchAll(/"crons":\s*\[([^\]]*)\]/g)].map((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((c) => c[1]!));
    expect(lists.length).toBeGreaterThanOrEqual(1);
    for (const crons of lists) {
      // minute hour day-of-month month day-of-week: a fixed time on one weekday.
      expect(crons.some((c) => /^\d+ \d+ \* \* [0-6]$/.test(c)), crons.join(", ")).toBe(true);
    }
  });

  it("the nominations bullet states the code's limit, and the limit plus one week", () => {
    const days = constant("worker/routes/nominate.ts", "NOMINATION_RETENTION_DAYS");
    expect(days).toBe(180);
    expect(POLICY).toContain(
      `If your nomination is still waiting for an edition when it is ${days} days old, a weekly job deletes the figures, your name and your email (our commitment).`,
    );
    expect(POLICY).toContain(`keeps its figures, name or email longer than ${days + 7} days (our commitment).`);
  });

  it("the security-reports bullet states the code's limit", () => {
    const days = constant("worker/routes/csp-report.ts", "CSP_REPORT_RETENTION_DAYS");
    expect(days).toBe(90);
    expect(bullet("Security reports")).toContain(
      `A weekly job deletes each type of report that no browser has sent in the last ${days} days (our commitment).`,
    );
  });

  // The runbook is under ops/, which the public export leaves out.
  it.skipIf(!IN_ARCHIVE)("the runbook's purpose limit says the weekly limit, not the old monthly one", () => {
    const runbook = read("../ops/runbooks/promote-submissions/nominations.md");
    expect(runbook).toContain("That keeps every row no edition claimed within 187 days");
    expect(runbook).not.toContain("211 days");
  });
});
