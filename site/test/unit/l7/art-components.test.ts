// L7: pure helpers behind the art components (site/src/components/art/).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { brandArt, fitWidths } from "../../../src/components/art/art-assets";
import { EMBERS, emberStyle } from "../../../src/components/art/embers";
import { KEEPERS, portraitAlt, portraitKeys } from "../../../src/components/art/keepers";

describe("keepers", () => {
  it("covers exactly the three agents in data/team/dwarves.yaml", () => {
    expect(Object.keys(KEEPERS).sort()).toEqual(["communitas", "publicus", "resourcus"]);
  });

  it("agrees with the kind in data/team/dwarves.yaml, which wins (decision 43)", () => {
    const file = path.join(__dirname, "../../../../data/team/dwarves.yaml");
    const keepers = YAML.parse(readFileSync(file, "utf8")) as { id: keyof typeof KEEPERS; kind: string; portrait: string }[];
    for (const k of keepers) {
      expect(KEEPERS[k.id]?.kind, k.id).toBe(k.kind);
      expect(portraitKeys(k.id).large, k.id).toBe(k.portrait);
    }
  });

  it("paints Resourcus as a gnome and the other two as dwarves (decision 43)", () => {
    expect(KEEPERS.resourcus.kind).toBe("gnome");
    expect(KEEPERS.communitas.kind).toBe("dwarf");
    expect(KEEPERS.publicus.kind).toBe("dwarf");
  });

  it("says every portrait is an AI agent", () => {
    for (const id of ["communitas", "resourcus", "publicus"] as const) {
      expect(portraitAlt(id, "Name", "Title")).toMatch(/an AI agent/);
    }
    expect(portraitAlt("resourcus", "Resourcus", "Keeper of Startup Resources")).toBe(
      "Resourcus, Keeper of Startup Resources: an AI agent, painted as a gnome.",
    );
  });

  it("maps to the brand v3 portraits, brand/<id>", () => {
    expect(portraitKeys("publicus")).toEqual({ large: "brand/publicus", small: "brand/publicus-small" });
  });

  // Portrait.astro has no fallback for a missing crop: a small portrait shows
  // the -small file, so every keeper needs both pulled, with every webp size.
  it("has both portrait crops pulled for every keeper, at 4:5 and 1:1", () => {
    const pub = path.join(__dirname, "../../../public");
    for (const id of Object.keys(KEEPERS) as (keyof typeof KEEPERS)[]) {
      const { large, small } = portraitKeys(id);
      const big = brandArt(large);
      const crop = brandArt(small);
      expect(big, large).toBeDefined();
      expect(crop, small).toBeDefined();
      expect(big!.width * 5, large).toBe(big!.height * 4);
      expect(crop!.width, small).toBe(crop!.height);
      for (const art of [big!, crop!]) {
        for (const entry of art.srcset.split(", ")) expect(existsSync(path.join(pub, entry.split(" ")[0])), entry).toBe(true);
      }
    }
  });

  it("lights a glow only where a keeper holds a lantern", () => {
    expect(KEEPERS.communitas.glow).not.toBeNull();
    expect(KEEPERS.resourcus.glow).toBeNull();
    expect(KEEPERS.publicus.glow).toBeNull();
  });
});

describe("fitWidths", () => {
  it("never asks Astro for a width larger than the source", () => {
    for (const w of fitWidths([640, 960, 1280, 1920, 2400], 1568)) expect(w).toBeLessThanOrEqual(1568);
  });

  // #205: the 1568 px hero stopped at 1280w, so a 2x laptop screen stretched it.
  it("adds the source width when it drops a wider width", () => {
    expect(fitWidths([640, 960, 1280, 1920, 2400], 1568)).toEqual([640, 960, 1280, 1568]);
  });

  it("adds the source width only once", () => {
    expect(fitWidths([640, 960, 1360, 1920], 1360)).toEqual([640, 960, 1360]);
  });

  it("leaves the widths alone when the source fills them all", () => {
    expect(fitWidths([400, 640, 800], 1360)).toEqual([400, 640, 800]);
    expect(fitWidths([96, 160, 320], 320)).toEqual([96, 160, 320]);
  });

  it("falls back to the source width when every width is too large", () => {
    expect(fitWidths([480, 720], 320)).toEqual([320]);
  });

  it("falls back to the source width when given no widths", () => {
    expect(fitWidths([], 320)).toEqual([320]);
  });
});

describe("embers", () => {
  it("has a fixed layout inside the box, so builds are reproducible", () => {
    expect(EMBERS.length).toBeGreaterThan(0);
    for (const e of EMBERS) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(100);
      expect(e.duration).toBeGreaterThan(0);
    }
  });

  it("writes only custom properties into the style attribute", () => {
    expect(emberStyle(EMBERS[0])).toBe("--x:12%;--d:0s;--t:3.6s;--size:4px;--dx:14px");
  });
});
