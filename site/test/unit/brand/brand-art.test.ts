import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_NAMES, brandArt } from "../../../src/components/art/art-assets";
import { PLACE_ART_ALT } from "../../../src/components/art/keepers";
import { PLACE_CREDITS, WEBSITE_ART_CREDITS } from "../../../src/lib/brand-credits";

// Brand v3 art comes only from a pinned brand release (brand.lock.json, pulled
// by scripts/brand/pull.mjs). Every name the site uses is locked and pulled at
// every size it lists; each place painting also has an alt and a photo credit
// (keeper portraits: art-components.test.ts), and nothing else resolves.
const repo = path.resolve(__dirname, "../../../..");
const lock = JSON.parse(readFileSync(path.join(repo, "brand.lock.json"), "utf8")) as { files: Record<string, string> };
const PLACES = Object.keys(PLACE_ART_ALT) as (keyof typeof PLACE_ART_ALT)[];

describe("brand art", () => {
  it.each(BRAND_NAMES)("%s is locked and pulled at every size it lists", (name) => {
    expect(Object.keys(lock.files).some((p) => p.replace(/^.*\//, "").replace(/\.[a-z]+$/, "") === name), name).toBe(true);
    const art = brandArt(`brand/${name}`)!;
    for (const entry of art.srcset.split(", ")) {
      expect(existsSync(path.join(repo, "site/public", entry.split(" ")[0])), entry).toBe(true);
    }
  });

  it.each(PLACES)("place %s is pulled at 720 and 1440, captioned and credited", (name) => {
    expect(Object.keys(lock.files)).toContain(`dist/places/${name}.jpg`);
    expect(brandArt(`brand/${name}`)?.srcset).toBe(`/art/brand/${name}-720.webp 720w, /art/brand/${name}-1440.webp 1440w`);
    expect(PLACE_ART_ALT[name].length).toBeGreaterThan(20);
    expect(PLACE_CREDITS[name].credit).toMatch(/photo/i);
  });

  it("credits every pulled picture on /credits/, and says AI agent beside each keeper", () => {
    const credited = new Set([...Object.keys(PLACE_CREDITS), ...WEBSITE_ART_CREDITS.flatMap((w) => w.names)]);
    expect(BRAND_NAMES.filter((n) => !credited.has(n))).toEqual([]);
    for (const w of WEBSITE_ART_CREDITS.filter((c) => /^(communitas|resourcus|publicus)$/.test(c.names[0]!))) {
      expect(w.picture, w.names[0]).toContain("AI agent");
    }
  });

  it("resolves no other key", () => {
    expect(brandArt("brand/nowhere")).toBeUndefined();
    expect(brandArt("hero/hall")).toBeUndefined();
  });
});
