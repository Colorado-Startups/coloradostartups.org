import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isOffSite,
  judgeChain,
  parseMap,
  parseSitemapList,
  readMap,
  readOldSitemap,
  renderRedirects,
  selfRedirects,
  sourcePaths,
  // @ts-expect-error plain .mjs ops module without type declarations
} from "../../../../ops/redirects/map.mjs";

type Row = { old: string; to: string; reason: string };
type Hop = { status: number; to: string };
const rows: Row[] = readMap();
const redirectsFile = readFileSync(path.join(__dirname, "../../../public/_redirects"), "utf8");
const sources: string[] = rows.flatMap((r) => sourcePaths(r));
const isKept = (r: Row) => r.to === `${r.old}/`;
const onSite = rows.filter((r) => !isOffSite(r.to));
const offSite = rows.filter((r) => isOffSite(r.to));
// The Slack sign-up's one home (#128): a Google Form, as the form's own page
// title said on 2026-10-18 ("Join the Colorado Startups Slack Community").
const GOOGLE_FORM = /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/;

// PLAN.md, Pages and URLs: aliases of kept pages and the retired list.
const PLAN_OLD_PATHS = [
  "/overview", "/social-groups", "/resources", "/the-team", "/about",
  "/event-connect", "/startup-happy-hour", "/ski-days", "/startup-hikes", "/gift-guide",
  "/pitch-colorado", "/seed-angel-forum", "/store", "/new-page-1", "/new-events-1", "/home", "/cart",
];

// A redirect may only land on a path the new site serves: a page file renders
// /team/ from src/pages/team.astro or src/pages/team/index.astro, and
// @astrojs/sitemap writes /sitemap-index.xml at build time.
const PAGES_DIR = path.join(__dirname, "../../../src/pages");
const BUILD_FILES = new Set(["/sitemap-index.xml"]);
function isRealTarget(page: string): boolean {
  if (BUILD_FILES.has(page)) return true;
  if (!page.endsWith("/")) return false;
  const stem = page === "/" ? "index" : page.slice(1, -1);
  return [`${stem}.astro`, `${stem}/index.astro`].some((file) => existsSync(path.join(PAGES_DIR, file)));
}

describe("redirect map", () => {
  it("_redirects is exactly what map.csv renders to", () => {
    expect(redirectsFile).toBe(renderRedirects(rows));
  });
  it("covers every old path PLAN.md names", () => {
    const olds = new Set(rows.map((r) => r.old));
    expect(PLAN_OLD_PATHS.filter((p) => !olds.has(p))).toEqual([]);
  });
  it("redirects the two old pages the Canvas Doc links (#394)", () => {
    const to = Object.fromEntries(rows.map((r) => [r.old, r.to]));
    expect(to["/request-help"]).toBe("/contact/");
    expect(to["/celebrate-wins"]).toBe("/community/");
  });
  it("lists each old path once, never chains, and lands on a real new page", () => {
    const olds = rows.map((r) => r.old);
    expect(new Set(olds).size).toBe(olds.length);
    for (const r of onSite) {
      // A target may name a section of its page with a #fragment (L13 review).
      const [page, fragment] = r.to.split("#");
      // Every emitted source, slash forms included, so /x -> /about/ cannot
      // chain through the rule for /about/.
      expect(sources, r.old).not.toContain(page);
      expect(isRealTarget(page), `${r.old} -> ${page}`).toBe(true);
      if (fragment !== undefined) expect(fragment, r.old).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
  it("never redirects a path to itself", () => {
    expect(selfRedirects(redirectsFile)).toEqual([]);
  });
  it("sends only the Slack short links off the site, all to the one sign-up form", () => {
    expect(offSite.map((r) => r.old)).toEqual(["/slack", "/join"]);
    expect(new Set(offSite.map((r) => r.to)).size).toBe(1);
    expect(offSite[0].to).toMatch(GOOGLE_FORM);
    expect(redirectsFile.split("\n").filter((l) => l.endsWith(" 302"))).toEqual(
      offSite.flatMap((r) => sourcePaths(r).map((p: string) => `${p} ${r.to} 302`)),
    );
  });
  it("never sends another path to the Leaderboard (it stays apart from investing) but /nominate", () => {
    // The kept /leaderboard row only adds the trailing slash to its own page.
    // /nominate is a short link to the nomination form, not an investing page
    // (decision 17 keeps visitors who invest away from the Leaderboard).
    const toLeaderboard = rows.filter((r) => !isKept(r) && r.to.startsWith("/leaderboard"));
    expect(toLeaderboard.map((r) => [r.old, r.to])).toEqual([["/nominate", "/leaderboard/nominate/"]]);
  });
  it("stays far under the 2,000 static rule limit (Cloudflare static-assets redirects doc)", () => {
    const rules = redirectsFile.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rules.length).toBe(sources.length);
    expect(rules.length).toBeLessThan(2000);
  });
});

describe("the old Squarespace sitemap (GO-LIVE B2)", () => {
  const oldPaths: string[] = readOldSitemap();

  it("lists the 20 paths read from the live sitemap on 2026-10-18, each once", () => {
    expect(oldPaths).toHaveLength(20);
    expect(new Set(oldPaths).size).toBe(oldPaths.length);
  });
  it("has a map.csv row for every path, so none is left to html_handling's 307", () => {
    const olds = new Set(rows.map((r) => r.old));
    expect(oldPaths.filter((p) => !olds.has(p))).toEqual([]);
  });
});

describe("self-tests", () => {
  it("parseMap accepts a clean sample and keeps commas inside the reason", () => {
    expect(parseMap("old_path,new_path,reason\n/a,/b/,one, two")).toEqual([{ old: "/a", to: "/b/", reason: "one, two" }]);
  });
  it("parseMap rejects a bad header, a relative path and a missing reason", () => {
    expect(() => parseMap("from,to\n/a,/b/")).toThrow();
    expect(() => parseMap("old_path,new_path,reason\na,/b/,x")).toThrow();
    expect(() => parseMap("old_path,new_path,reason\n/a,/b/")).toThrow();
  });
  it("parseMap takes an https:// new path and rejects http:// or a bare host", () => {
    expect(parseMap("old_path,new_path,reason\n/a,https://x.example/f,x")[0].to).toBe("https://x.example/f");
    expect(() => parseMap("old_path,new_path,reason\n/a,http://x.example/f,x")).toThrow();
    expect(() => parseMap("old_path,new_path,reason\n/a,x.example/f,x")).toThrow();
  });
  it("renders an off-site row as a 302 in both forms", () => {
    const rules = renderRedirects([{ old: "/a", to: "https://x.example/f", reason: "x" }])
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(rules).toEqual(["/a https://x.example/f 302", "/a/ https://x.example/f 302"]);
  });
  it("renders a moved page in both forms and a kept page without the slash only", () => {
    const moved = { old: "/a", to: "/b/", reason: "x" };
    const kept = { old: "/c", to: "/c/", reason: "x" };
    const rules = renderRedirects([moved, kept]).split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rules).toEqual(["/a /b/ 301", "/a/ /b/ 301", "/c /c/ 301"]);
  });
  it("selfRedirects flags a path sent to itself, with or without a fragment", () => {
    expect(selfRedirects("# a comment\n/a /a/ 301\n/b /c/ 301\n")).toEqual([]);
    expect(selfRedirects("/a/ /a/ 301\n/b/ /b/#top 301\n/c /d/ 301")).toEqual(["/a/ /a/ 301", "/b/ /b/#top 301"]);
  });
  it("isRealTarget knows a page file from a missing one", () => {
    expect(isRealTarget("/team/")).toBe(true);
    expect(isRealTarget("/")).toBe(true);
    expect(isRealTarget("/nope/")).toBe(false);
    expect(isRealTarget("/team")).toBe(false);
  });
  it("parseSitemapList skips comments and blanks, and rejects a malformed line", () => {
    expect(parseSitemapList("# source\n\n/a\n  /b  \n")).toEqual(["/a", "/b"]);
    expect(() => parseSitemapList("a")).toThrow(/line 1/);
    expect(() => parseSitemapList("# x\n/a b")).toThrow(/line 2/);
  });

  const hops = (...list: [number, string?][]): Hop[] => list.map(([status, to = ""]) => ({ status, to }));
  it("judgeChain passes a 200 and a single 301 to a 200 (known clean)", () => {
    expect(judgeChain(hops([200]))).toBeNull();
    expect(judgeChain(hops([301, "/contact/"], [200]))).toBeNull();
  });
  it("judgeChain fails a temporary redirect, a loop, an off-site hop and a bad end (known bad)", () => {
    expect(judgeChain(hops([307, "/contact/"], [200]))).toBe("307 -> /contact/ is not a 301");
    expect(judgeChain(hops([308, "/contact/"], [200]))).toMatch(/^308 /);
    expect(judgeChain(hops([301, "/a/"], [302, "/b/"], [200]))).toMatch(/^302 /);
    expect(judgeChain(hops(...Array.from({ length: 6 }, (): [number, string] => [301, "/a/"])))).toMatch(/loop/);
    expect(judgeChain(hops([301, "https://other.example/"], [200]))).toMatch(/leaves the site/);
    expect(judgeChain(hops([301]))).toMatch(/no Location/);
    expect(judgeChain(hops([404]))).toBe("answered 404, want 200");
    expect(judgeChain(hops([301, "/a/"], [500]))).toBe("answered 500, want 200");
    expect(judgeChain([])).toBe("no response");
  });
  it("judgeChain words a clean walk to a 404 the way smoke-lib.mjs reads as pending", () => {
    expect(judgeChain(hops([301, "/team/#top"], [404]))).toBe("target /team/ answered 404");
  });
});
