import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// L5b: region art asks for a file no wider than it draws. The Quality page's
// mobile lab loads each page at 412 px and 1.75x (Lighthouse's mobile
// settings), where a region page's hero draws 364 px wide: 412 less two 24 px
// gutters. Brand v3 paintings ship 720w and 1440w webp, so the lab fetches the
// 720w. /regions/ shows the regions as chips and the home page's theme panels
// since step H (2026-11-15), so it has no region cards to size. Built HTML
// from dist/ (run `npm run build` first).

const LAB = { width: 412, dpr: 1.75 };

// Evaluates the `sizes` forms RegionArt uses: "(max-width: Npx) length"
// entries and a bare default; a length is "Npx", "Nvw" or "calc(Avw - Bpx)".
function drawnWidth(sizes: string, viewport: number): number {
  for (const entry of sizes.split(/,\s*(?![^(]*\))/)) {
    const m = entry.trim().match(/^(?:\(max-width:\s*(\d+)px\)\s+)?(.+)$/);
    if (!m) throw new Error(`unreadable sizes entry: ${entry}`);
    const [, max, length] = m;
    if (max && viewport > Number(max)) continue;
    const calc = length!.match(/^calc\((\d+)vw - (\d+)px\)$/);
    if (calc) return (viewport * Number(calc[1])) / 100 - Number(calc[2]);
    if (length!.endsWith("vw")) return (viewport * parseFloat(length!)) / 100;
    return parseFloat(length!);
  }
  throw new Error(`no sizes entry matches ${viewport} px: ${sizes}`);
}

// The candidate a browser picks: the narrowest that covers the drawn width
// at the screen's density, or the widest when none does.
function pickedWidth(img: Element, viewport = LAB.width, dpr = LAB.dpr): number {
  const need = drawnWidth(img.getAttribute("sizes") ?? "", viewport) * dpr;
  const widths = (img.getAttribute("srcset") ?? "")
    .split(",")
    .map((c) => Number(c.trim().split(/\s+/)[1]?.replace("w", "")))
    .sort((a, b) => a - b);
  return widths.find((w) => w >= need) ?? widths.at(-1)!;
}

const doc = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");

describe("region art sizes (mobile LCP on the region pages)", () => {
  it.each(REGION_IDS)("/regions/%s/: the hero asks for the 720w file at 412 px", (id) => {
    const img = doc(`regions/${id}/index.html`).querySelector("main .region-art--hero img");
    expect(img).not.toBeNull();
    expect(drawnWidth(img!.getAttribute("sizes")!, LAB.width)).toBe(364);
    expect(pickedWidth(img!)).toBe(720);
  });
});
