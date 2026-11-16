import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { contentPages, DIST_DIR } from "./pages";

// M1b: every built page loads the click-event helper (src/lib/track.ts)
// through an external module script, and no page marks anything with
// data-track yet (step M1c adds the marks). With no mark and no automatic
// event, the site makes no request to /api/e. Run `npm run build` first.
//
// Astro may put the helper in the page's own entry file or in a chunk that
// entry imports, so the test follows each entry's static imports.

// The helper's file is the one /_astro/ script that names the route.
const TRACK_MARK = /["'`]\/api\/e["'`]/;
// A goal for the helper's share of the 75 KB up-front budget.
const MAX_GZIP_BYTES = 1500;

const pages = contentPages();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+\.js|\/_astro\/[^"']+\.js)["']/g;

function readAsset(src: string): string {
  const file = path.join(DIST_DIR, src);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** Each /_astro/ module a file imports, as a site path. */
function importsOf(src: string): string[] {
  return [...readAsset(src).matchAll(IMPORT)].map((m) => (m[1].startsWith("/") ? m[1] : path.posix.join(path.posix.dirname(src), m[1])));
}

/** Every /_astro/ module the page's module scripts load, entries first. */
function loadedModules(html: string): { entries: string[]; all: string[] } {
  const entries = [...parse(html).querySelectorAll('script[type="module"][src^="/_astro/"]')].map((s) => s.getAttribute("src")!);
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const src = queue.shift()!;
    if (seen.has(src)) continue;
    seen.add(src);
    queue.push(...importsOf(src));
  }
  return { entries, all: [...seen] };
}

const trackFiles = (html: string) => loadedModules(html).all.filter((src) => TRACK_MARK.test(readAsset(src)));

describe("the track helper on every built page", () => {
  for (const page of pages) {
    it(`${page.route} loads it once, through an external module script, with no data-track mark`, () => {
      const { entries } = loadedModules(page.html);
      expect(entries.length, `${page.route} module scripts`).toBeGreaterThan(0);
      expect(trackFiles(page.html), `${page.route} loads ${entries.join(", ")}`).toHaveLength(1);
      expect(page.html).not.toMatch(/\sdata-track[\s=>-]/);
    });
  }

  it(`stays under ${MAX_GZIP_BYTES} bytes gzipped`, () => {
    const src = trackFiles(pages.find((p) => p.route === "/")!.html)[0];
    expect(src).toBeTruthy();
    const raw = readFileSync(path.join(DIST_DIR, src));
    const gz = gzipSync(raw, { level: 9 }).byteLength;
    // CI prints this line, for the PR's up-front bytes.
    console.log(`track helper ${src}: ${raw.byteLength} bytes, ${gz} bytes gzipped`);
    expect(gz).toBeLessThan(MAX_GZIP_BYTES);
  });
});
