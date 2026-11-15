import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_NAMES, brandArt } from "../../../src/components/art/art-assets";
import { PLACE_ART_ALT } from "../../../src/components/art/keepers";
import { PLACE_CREDITS } from "../../../src/lib/brand-credits";

// Brand v3 art comes only from a pinned brand release (brand.lock.json, pulled
// by scripts/brand/pull.mjs). Every name the site uses is locked, pulled, has an
// alt and a credit, and nothing else resolves.
const repo = path.resolve(__dirname, "../../../..");
const lock = JSON.parse(readFileSync(path.join(repo, "brand.lock.json"), "utf8")) as { files: Record<string, string> };

describe("brand art", () => {
  it.each(BRAND_NAMES)("%s is locked, pulled in both sizes, captioned and credited", (name) => {
    expect(Object.keys(lock.files)).toContain(`dist/places/${name}.jpg`);
    for (const file of [`${name}.jpg`, `${name}-720.webp`, `${name}-1440.webp`]) {
      expect(existsSync(path.join(repo, "site/public/art/brand", file)), file).toBe(true);
    }
    expect(PLACE_ART_ALT[name].length).toBeGreaterThan(20);
    expect(PLACE_CREDITS[name].credit).toMatch(/photo/i);
    expect(brandArt(`brand/${name}`)?.srcset).toContain(`${name}-720.webp 720w`);
  });

  it("resolves no other key", () => {
    expect(brandArt("brand/nowhere")).toBeUndefined();
    expect(brandArt("hero/hall")).toBeUndefined();
  });
});
