import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { contentPages, readDist } from "../pages";

// Page polish (#205): the art srcsets reach the source width, and never pass it.
// fitWidths() in src/components/art/art-assets.ts does the work; this checks
// the built HTML that ships.

const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");

/** The widths in a srcset, e.g. [640, 960, 1280, 1568]. */
function widthsOf(srcset: string | null): number[] {
  return (srcset ?? "")
    .split(",")
    .map((c) => Number.parseInt(c.trim().split(/\s+/)[1] ?? "", 10))
    .filter((w) => Number.isFinite(w));
}
const srcsetWidths = (img: Element) => widthsOf(img.getAttribute("srcset"));

// ArtImage and Portrait put the <img> first inside the element that carries
// data-art or data-portrait. A regex over the raw HTML keeps the whole-site
// pass fast; DOMParser on every page outruns the default timeout.
const ART_IMG = /\bdata-(?:art|portrait)="([^"]+)"[^>]*>\s*<img\b([^>]*)>/g;
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

describe("art srcsets", () => {
  it("never list a width wider than the source, on any page", { timeout: 30_000 }, () => {
    let seen = 0;
    for (const page of contentPages()) {
      for (const [, key, tag] of page.html.matchAll(ART_IMG)) {
        seen += 1;
        const source = Number(attr(tag, "width"));
        for (const w of widthsOf(attr(tag, "srcset"))) expect(w, `${page.route} ${key}`).toBeLessThanOrEqual(source);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("reach the source width on the home hero, for 2x screens", () => {
    const img = doc("index.html").querySelector('[data-art="hero/hall"] img')!;
    expect(img).not.toBeNull();
    expect(Math.max(...srcsetWidths(img))).toBe(Number(img.getAttribute("width")));
  });

  it("reach the source width on each region page's hero", () => {
    for (const id of REGION_IDS) {
      const img = doc(`regions/${id}/index.html`).querySelector(`[data-art="regions/${id}"] img`)!;
      expect(img, id).not.toBeNull();
      expect(Math.max(...srcsetWidths(img)), id).toBe(Number(img.getAttribute("width")));
    }
  });
});
