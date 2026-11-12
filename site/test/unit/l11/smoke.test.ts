// Contract and self-test for site/test/live/smoke.mjs. The live script runs by
// hand against a deployed site; its judging rules and its data sources run
// here on every test pass, with no network.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error plain .mjs ops module without type declarations
import { readMap } from "../../../../ops/redirects/map.mjs";
import {
  exitCode,
  FORM_ROUTES,
  fragmentTargets,
  judgeAccessGate,
  judgeAnchor,
  judgeAskToken,
  judgeBurst,
  judgeFormToken,
  judgeHeaders,
  judgePage,
  judgeRedirects,
  NAV_PAGES,
  parseHeadersFile,
  rateLimits,
  runSelfTest,
  type Result,
} from "../../live/smoke-lib.mjs";
import { parseJsonc } from "../../jsonc.mjs";
import { APPLY_ENDPOINT, APPLY_THANKS_PATH, parseApplicationForm } from "../../../src/components/apply/fields";
import { NOMINATE_THANKS_PATH } from "../../../src/lib/leaderboard/nomination";
import { ALL_SECURITY_HEADERS } from "../../../worker/lib/security-headers";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const level = (r: Result) => r.level;

describe("smoke-lib data sources", () => {
  it("reads the same security headers from public/_headers as the Worker sets", () => {
    const parsed = parseHeadersFile(read("../../../public/_headers"));
    expect(parsed).toEqual(ALL_SECURITY_HEADERS.map(([n, v]) => [n, v]));
  });

  it("parses both wrangler.jsonc files, URLs in strings included", () => {
    const site = parseJsonc(read("../../../wrangler.jsonc")) as Record<string, any>;
    const communitas = parseJsonc(read("../../../../workers/communitas/wrangler.jsonc")) as Record<string, any>;
    expect(site.name).toBe("coloradostartups-site");
    expect(communitas.vars.SITE_ORIGIN).toBe("https://coloradostartups.org");
  });

  it("finds both rate limits at the top level and in staging", () => {
    const site = parseJsonc(read("../../../wrangler.jsonc")) as Record<string, any>;
    for (const env of [undefined, "staging"]) {
      const limits = rateLimits(site, env);
      expect(limits.FORM_RATE_LIMIT, String(env)).toBeGreaterThan(0);
      expect(limits.ASK_RATE_LIMIT, String(env)).toBeGreaterThan(0);
    }
  });

  it("uses the nomination thanks path the Leaderboard defines", () => {
    expect(FORM_ROUTES.find((r) => r.path === "/api/nominate")?.thanks).toBe(NOMINATE_THANKS_PATH);
  });

  it("sends an application the form parser accepts, to the form's own endpoint and thanks page", () => {
    const route = FORM_ROUTES.find((r) => r.path === APPLY_ENDPOINT);
    expect(route?.thanks).toBe(APPLY_THANKS_PATH);
    // A payload that failed validation would stop before Turnstile and the
    // smoke run would only report CANNOT, so the check would never run.
    const form = new FormData();
    for (const [k, v] of Object.entries(route!.fields(Date.now()))) form.set(k, String(v));
    expect(parseApplicationForm(form)).toMatchObject({ ok: true });
  });

  it("lists each nav page once, with trailing slashes on pages", () => {
    const paths = NAV_PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of NAV_PAGES.filter((p) => p.kind === "html")) expect(p.path.endsWith("/"), p.path).toBe(true);
  });

  it("never sends a payload that could pass Turnstile", () => {
    for (const route of FORM_ROUTES) {
      expect(route.fields(Date.now())["cf-turnstile-response"]).toBe("smoke-invalid-token");
      expect(route.fields(Date.now()).website, "the honeypot stays empty").toBeUndefined();
    }
  });
});

describe("smoke-lib judging rules", () => {
  it("passes its own seeded self-test", () => {
    expect(runSelfTest()).toEqual([]);
  });

  it("fails a public staging site and passes an Access login redirect", () => {
    expect(level(judgeAccessGate(200, null))).toBe("FAIL");
    expect(level(judgeAccessGate(302, "https://x.cloudflareaccess.com/cdn-cgi/access/login/y"))).toBe("ok");
    expect(level(judgeAccessGate(403, null))).toBe("ok");
  });

  it("treats a 404 page as pending and a 5xx as a failure", () => {
    expect(level(judgePage(NAV_PAGES[1], 404, "text/html", null))).toBe("PENDING");
    expect(level(judgePage(NAV_PAGES[1], 503, "text/html", null))).toBe("FAIL");
    expect(level(judgePage(NAV_PAGES[1], 301, "text/html", "/community"))).toBe("FAIL");
  });

  it("fails a changed or missing header", () => {
    const expected: [string, string][] = [["X-Frame-Options", "DENY"]];
    expect(judgeHeaders(expected, new Headers({ "X-Frame-Options": "SAMEORIGIN" }), "t").map(level)).toEqual(["FAIL"]);
    expect(judgeHeaders(expected, new Headers({ "X-Frame-Options": "DENY" }), "t").map(level)).toEqual(["ok"]);
  });

  it("fails each route that lands on its thanks page with the bad token", () => {
    for (const route of FORM_ROUTES) {
      expect(level(judgeFormToken(route, 303, `https://h${route.thanks}`)), route.path).toBe("FAIL");
      expect(level(judgeFormToken(route, 303, `https://h/x/?error=verification`)), route.path).toBe("ok");
      expect(level(judgeFormToken(route, 303, `https://h/x/?error=delivery`)), route.path).toBe("FAIL");
    }
  });

  it("reads 'unavailable' as pending Kit setup only on subscribe", () => {
    const at = (path: string) => FORM_ROUTES.find((r) => r.path === path)!;
    expect(level(judgeFormToken(at("/api/subscribe"), 303, "https://h/newsletter/?error=unavailable"))).toBe("PENDING");
    expect(level(judgeFormToken(at("/api/nominate"), 303, "https://h/x/?error=unavailable"))).toBe("FAIL");
  });

  it("fails an answered question and passes a 403 verification", () => {
    expect(level(judgeAskToken(200, { answer: "x" }))).toBe("FAIL");
    expect(level(judgeAskToken(403, { error: "verification" }))).toBe("ok");
    expect(level(judgeAskToken(429, { error: "rate-limit" }))).toBe("CANNOT");
  });

  it("reads a redirect run whose only failures are 404 targets as PENDING", () => {
    const run = (fails: string[]) => judgeRedirects(1, [...fails, `${fails.length} failed, 0 unreachable`]);
    expect(level(run(["FAIL /the-team: target /team/ answered 404", "FAIL /about/: target /team/ answered 404"]))).toBe("PENDING");
    expect(run(["FAIL /ski-days: target /event-calendar/#hikes-and-ski-days answered 404"]).detail).toContain(
      "/event-calendar/#hikes-and-ski-days",
    );
    expect(level(run(["FAIL /home: 302 -> /, want 301 -> /"]))).toBe("FAIL");
    expect(level(run(["FAIL /home: 302 -> /, want 301 -> /", "FAIL /the-team: target /team/ answered 404"]))).toBe("FAIL");
    expect(level(judgeRedirects(1, ["1 failed, 0 unreachable"]))).toBe("FAIL");
    expect(level(judgeRedirects(0, ["0 failed, 0 unreachable"]))).toBe("ok");
  });

  it("checks every #section the redirect map lands on", () => {
    const targets = fragmentTargets(readMap() as { to: string }[]);
    expect(targets).toContainEqual({ page: "/event-calendar/", id: "hikes-and-ski-days" });
    expect(level(judgeAnchor(targets[0]!, 200, `<section id="${targets[0]!.id}">`))).toBe("ok");
    expect(level(judgeAnchor(targets[0]!, 200, "<section>"))).toBe("PENDING");
  });

  it("warns, never fails, when a burst sees no limit answer", () => {
    expect(level(judgeBurst("/api/ask", ["http-400", "http-400"], 20))).toBe("WARN");
    expect(level(judgeBurst("/api/ask", ["http-400", "ratelimit"], 20))).toBe("ok");
    expect(level(judgeBurst("/api/ask", ["http-400", "infra"], 20))).toBe("CANNOT");
  });

  it("exits 1 on any FAIL, 3 on could-not-check, 0 otherwise", () => {
    const r = (lvl: Result["level"]): Result => ({ level: lvl, check: "c", detail: "d" });
    expect(exitCode([r("ok"), r("PENDING"), r("WARN")])).toBe(0);
    expect(exitCode([r("ok"), r("CANNOT")])).toBe(3);
    expect(exitCode([r("CANNOT"), r("FAIL")])).toBe(1);
  });
});
