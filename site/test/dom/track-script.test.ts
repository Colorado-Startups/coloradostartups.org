import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { contentPages, DIST_DIR } from "./pages";

// M1b: every built page loads the click-event helper (src/lib/track.ts) as an
// external module script, and no page marks anything with data-track yet
// (step M1c adds the marks). With no mark and no automatic event, the site
// makes no request to /api/e. Run `npm run build` first.

// The helper's bundle is the one /_astro/ script that names the route.
const TRACK_MARK = '"/api/e"';
// A goal for the helper's share of the 75 KB up-front budget.
const MAX_GZIP_BYTES = 1500;

const pages = contentPages();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

function trackScripts(html: string): string[] {
  return [...parse(html).querySelectorAll("script[src]")]
    .map((s) => s.getAttribute("src") ?? "")
    .filter((src) => src.startsWith("/_astro/") && readFileSync(path.join(DIST_DIR, src), "utf8").includes(TRACK_MARK));
}

describe("the track helper on every built page", () => {
  for (const page of pages) {
    it(`${page.route} loads it once, as an external module script, with no data-track mark`, () => {
      const srcs = trackScripts(page.html);
      expect(srcs).toHaveLength(1);
      const tag = parse(page.html).querySelector(`script[src="${srcs[0]}"]`)!;
      expect(tag.getAttribute("type")).toBe("module");
      expect(page.html).not.toMatch(/\sdata-track[\s=>-]/);
    });
  }

  it(`stays under ${MAX_GZIP_BYTES} bytes gzipped`, () => {
    const src = trackScripts(pages.find((p) => p.route === "/")!.html)[0];
    const raw = readFileSync(path.join(DIST_DIR, src));
    const gz = gzipSync(raw, { level: 9 }).byteLength;
    // CI prints this line, for the PR's up-front bytes.
    console.log(`track helper ${src}: ${raw.byteLength} bytes, ${gz} bytes gzipped`);
    expect(gz).toBeLessThan(MAX_GZIP_BYTES);
  });
});
