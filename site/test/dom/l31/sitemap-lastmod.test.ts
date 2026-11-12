// The built sitemap carries lastmod only where a page's data has a date
// (GO-LIVE item B8). Needs `npm run build` first; test:content does that.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readDist, SITE_DIR } from "../pages";

const DATA = path.resolve(SITE_DIR, "..", "data");

/** Sitemap entries as site-root-relative paths, each with its lastmod or null. */
function entries(): Map<string, string | null> {
  const xml = readDist("sitemap-0.xml");
  const out = new Map<string, string | null>();
  for (const [, url = ""] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(url)?.[1]?.replace("https://coloradostartups.org", "").trim() ?? "";
    out.set(loc, /<lastmod>([^<]+)<\/lastmod>/.exec(url)?.[1]?.trim() ?? null);
  }
  return out;
}

function frontMatter(file: string): Record<string, unknown> {
  return parse(readFileSync(file, "utf8").split(/^---$/m)[1] ?? "") as Record<string, unknown>;
}

const day = (v: string | null | undefined) => (v ?? "").slice(0, 10);

describe("sitemap lastmod", () => {
  const sitemap = entries();
  const dispatches = readdirSync(path.join(DATA, "dispatches")).filter((f) => f.endsWith(".md"));

  it("has a lastmod for every dispatch page, from the dispatch's own date", () => {
    expect(dispatches.length).toBeGreaterThan(0);
    for (const f of dispatches) {
      const route = `/dispatches/${f.replace(/\.md$/, "")}/`;
      expect(sitemap.has(route), route).toBe(true);
      expect(day(sitemap.get(route)), route).toBe(String(frontMatter(path.join(DATA, "dispatches", f)).date).slice(0, 10));
    }
  });

  it("dates the privacy policy from its updated field", () => {
    expect(day(sitemap.get("/privacy/"))).toBe(String(frontMatter(path.join(DATA, "legal/privacy.md")).updated).slice(0, 10));
  });

  it("has no lastmod for a page whose data has no date", () => {
    for (const route of ["/", "/team/", "/ecosystem-canvas/", "/regions/"]) {
      expect(sitemap.has(route), route).toBe(true);
      expect(sitemap.get(route), route).toBeNull();
    }
  });

  it("dates only the pages with a data date, so no lastmod comes from the build", () => {
    const dated = [...sitemap].filter(([, lastmod]) => lastmod !== null).map(([route]) => route);
    const expected = ["/dispatches/", "/leaderboard/", "/privacy/", ...dispatches.map((f) => `/dispatches/${f.replace(/\.md$/, "")}/`)];
    expect(dated.sort()).toEqual(expected.sort());
  });
});
