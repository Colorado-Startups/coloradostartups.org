// L7 over the built site (run `npm run build` first; test:content does): every
// page's og:image points at a card that exists, whatever expression or default
// produced the name. Cards come from scripts/og/build.mjs into site/public/og/.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contentPages, DIST_DIR, SITE_DIR } from "../pages";

const OG_DIR = path.join(SITE_DIR, "public", "og");
const REGION_DIR = path.resolve(SITE_DIR, "..", "data", "regions");
const regionIds = readdirSync(REGION_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""));

function ogImage(html: string): string | null {
  const meta = new DOMParser().parseFromString(html, "text/html").querySelector('meta[property="og:image"]');
  return meta?.getAttribute("content") ?? null;
}

// The card each page should name; any other page falls back to "default".
const EXPECTED: Record<string, string> = {
  "/": "home",
  "/community/": "community",
  "/founders/": "founders",
  "/team/": "team",
  "/get-involved/": "get-involved",
  "/dispatches/": "dispatches",
  "/regions/": "regions",
  "/leaderboard/": "leaderboard",
  "/ecosystem-canvas/": "ecosystem-canvas",
  ...Object.fromEntries(regionIds.map((id) => [`/regions/${id}/`, id])),
};

describe("og:image on every built page", () => {
  const pages = contentPages();

  it("finds the built pages", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  for (const page of pages) {
    it(`${page.route} names a card that exists`, () => {
      const url = ogImage(page.html);
      expect(url, "og:image meta").not.toBeNull();
      const name = new URL(url as string).pathname;
      expect(name).toMatch(/^\/og\/[a-z0-9-]+\.png$/);
      expect(existsSync(path.join(OG_DIR, path.basename(name))), `site/public/og${name.slice(3)}`).toBe(true);
      expect(existsSync(path.join(DIST_DIR, name)), `dist${name}`).toBe(true);
    });
  }

  for (const [route, card] of Object.entries(EXPECTED)) {
    it(`${route} uses the ${card} card`, () => {
      const page = pages.find((p) => p.route === route);
      expect(page, route).toBeDefined();
      expect(new URL(ogImage(page!.html) as string).pathname).toBe(`/og/${card}.png`);
    });
  }
});
