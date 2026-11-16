import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// L5b: region art asks for a file no wider than it draws. The Quality page's
// mobile lab loads each page at 412 px and 1.75x (Lighthouse's mobile
// settings), where a region page's map and painting each draw 364 px wide:
// 412 less two 24 px gutters. Brand v3 paintings ship 720w and 1440w webp, so
// the lab fetches the 720w; the map's relief ships 640w, 960w and 1280w, so it
// fetches the 640w. /regions/ shows the regions as chips and the home page's theme panels
// since step H (2026-11-15), so it has no region cards to size. Built HTML
// from dist/ (run `npm run build` first).

const LAB = { width: 412, dpr: 1.75 };

// Evaluates the `sizes` forms RegionArt uses: "(max-width: N) length"
// entries and a bare default; a length is "N", "Nvw" or "calc(Avw - B)",
// where N and B are px or rem. rem in `sizes` is the initial 16 px.
const PX_PER_REM = 16;
const toPx = (n: string, unit: string) => Number(n) * (unit === "rem" ? PX_PER_REM : 1);

function drawnWidth(sizes: string, viewport: number): number {
  for (const entry of sizes.split(/,\s*(?![^(]*\))/)) {
    const m = entry.trim().match(/^(?:\(max-width:\s*([\d.]+)(px|rem)\)\s+)?(.+)$/);
    if (!m) throw new Error(`unreadable sizes entry: ${entry}`);
    const [, max, maxUnit, length] = m;
    if (max && viewport > toPx(max, maxUnit!)) continue;
    const calc = length!.match(/^calc\((\d+)vw - ([\d.]+)(px|rem)\)$/);
    if (calc) return (viewport * Number(calc[1])) / 100 - toPx(calc[2]!, calc[3]!);
    if (length!.endsWith("vw")) return (viewport * parseFloat(length!)) / 100;
    const fixed = length!.match(/^([\d.]+)(px|rem)$/);
    if (fixed) return toPx(fixed[1]!, fixed[2]!);
    throw new Error(`unreadable sizes length: ${length}`);
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

describe("region page image sizes at the mobile lab's 412 px", () => {
  // Since step R1 the map leads and its relief is the mobile LCP image: it
  // draws across .wrap, 364 px, so at 1.75x it fetches the 640w file.
  it.each(REGION_IDS)("/regions/%s/: the map's relief asks for the 640w file at 412 px", (id) => {
    const img = doc(`regions/${id}/index.html`).querySelector("main #region-map img.colorado-map__relief");
    expect(img).not.toBeNull();
    expect(drawnWidth(img!.getAttribute("sizes")!, LAB.width)).toBe(364);
    expect(pickedWidth(img!)).toBe(640);
  });

  // The painting, further down the page, still asks for no more than it draws.
  it.each(REGION_IDS)("/regions/%s/: the painting asks for the 720w file at 412 px", (id) => {
    const img = doc(`regions/${id}/index.html`).querySelector("main .region-art--hero img");
    expect(img).not.toBeNull();
    expect(drawnWidth(img!.getAttribute("sizes")!, LAB.width)).toBe(364);
    expect(pickedWidth(img!)).toBe(720);
  });
});
