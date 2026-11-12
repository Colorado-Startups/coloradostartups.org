import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PHOTO_CROPS, photoCropStyle, photoCropZoom, photoWidths } from "../../../src/components/team/photo-crops";
import { ON_FIXTURES } from "../../people-source";

// Page polish, #256: the four Team photos get one treatment, and a photo
// framed unlike the others zooms to a square crop inside its ring. The built
// page side is in test/dom/page-polish/team-photos.test.ts.

const PHOTOS_DIR = new URL("../../../src/components/team/photos/", import.meta.url);
const photoNames = readdirSync(PHOTOS_DIR).map((f) => f.replace(/\.[^.]+$/, ""));
const CARD = readFileSync(new URL("../../../src/components/team/PersonCard.astro", import.meta.url), "utf8");
const STYLE = (/<style>([\s\S]*?)<\/style>/.exec(CARD)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");

// Crops are keyed by real photo names, so this block skips on fixtures.
describe.skipIf(ON_FIXTURES)("photo crops (#256)", () => {
  it("crops Lindsey's full-length photo, and only hers", () => {
    expect(Object.keys(PHOTO_CROPS)).toEqual(["lindsey-rohde"]);
  });

  for (const [name, crop] of Object.entries(PHOTO_CROPS)) {
    it(`${name}: names a photo in photos/ and stays inside it`, () => {
      expect(photoNames).toContain(name);
      expect(crop.size).toBeGreaterThan(0);
      expect(crop.size).toBeLessThanOrEqual(1);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.size).toBeLessThanOrEqual(1);
      expect(crop.y + crop.size).toBeLessThanOrEqual(1);
    });
  }

  it("turns a crop into the zoom and the shift PersonCard reads", () => {
    const { x, y, size } = PHOTO_CROPS["lindsey-rohde"]!;
    const style = photoCropStyle("lindsey-rohde") ?? "";
    const value = (prop: string) => new RegExp(`${prop}:\\s*([^;]+)`).exec(style)?.[1]?.trim();
    expect(Number(value("--photo-zoom"))).toBeCloseTo(1 / size, 3);
    for (const [prop, edge] of [["--photo-x", x], ["--photo-y", y]] as const) {
      expect(value(prop)).toMatch(/^-?[\d.]+%$/);
      expect(Number.parseFloat(value(prop)!)).toBeCloseTo(-edge * 100, 2);
    }
  });

  it("leaves a photo with no crop whole", () => {
    expect(photoCropStyle("paul-foley")).toBeUndefined();
    expect(photoCropStyle(undefined)).toBeUndefined();
    expect(photoCropZoom("paul-foley")).toBe(1);
    expect(photoWidths("paul-foley", [176, 352], 640)).toEqual([176, 352]);
  });

  it("grows a cropped photo's file widths by its zoom, up to the source width", () => {
    // 176 and 352 at a zoom of 1 / 0.55 are 320 and 640.
    expect(photoWidths("lindsey-rohde", [176, 352], 640)).toEqual([320, 640]);
    expect(photoWidths("lindsey-rohde", [176, 352], 500)).toEqual([320, 500]);
    expect(photoWidths("lindsey-rohde", [400, 600], 640)).toEqual([640]);
  });
});

describe("one photo treatment (#256)", () => {
  it("sets one filter in PersonCard, on the rule every photo matches", () => {
    const filters = [...STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => /(^|;|\s)filter:/.test(r[2]!));
    expect(filters).toHaveLength(1);
    expect(filters[0]![1]!.trim()).toBe(":global(.hall-card__media--inset img.person__photo)");
    expect(filters[0]![2]).toMatch(/filter:\s*grayscale\(1\)/);
  });

  it("draws the ring on the frame, which clips the zoomed photo", () => {
    const frame = /\.person__frame\s*\{([^{}]*)\}/.exec(STYLE)?.[1] ?? "";
    expect(frame).toMatch(/border-radius:\s*50%/);
    expect(frame).toMatch(/overflow:\s*hidden/);
    expect(frame).toMatch(/border:\s*var\(--line-bold\) solid var\(--c-accent\)/);
  });
});
