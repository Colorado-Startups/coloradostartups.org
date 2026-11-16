import { describe, expect, it } from "vitest";

import { HALL_ART_ALT } from "../../../src/components/art/keepers";
import { readDist } from "../pages";

// Home leads with Colorado (Paul, 2026-11-16: "The homepage should lead with
// the Colorado map too. Everything leads with Colorado."). The statewide map
// is the page's one statewide map, in the band right after the hero, and its
// relief is the first image in main and the only one that loads eagerly.
// Golden's painting is an accent in the last band, the Keepers, and waits
// until a visitor nears it. Built HTML from dist/ (run `npm run build` first;
// test:content does). e2e/home-map-first.spec.ts checks the same in a browser.

const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
const main = home.querySelector("main")!;
const bands = [...main.children].filter((el) => el.matches("section"));
const relief = main.querySelector<HTMLImageElement>("figure#home-map img.colorado-map__relief")!;
const painting = main.querySelector<HTMLImageElement>('[data-art="brand/golden"] img')!;

// The `sizes` forms Where.astro uses: "(max-width: N) length" entries and a
// bare default; a length is "Nrem", "Npx" or "calc(Avw - B)". rem in `sizes`
// is the initial 16 px. Copied in small from l5b/region-art-sizes.test.ts
// (importing a test file would run its tests here too).
const toPx = (n: string, unit: string) => Number(n) * (unit === "rem" ? 16 : 1);
function drawnWidth(sizes: string, viewport: number): number {
  for (const entry of sizes.split(/,\s*(?![^(]*\))/)) {
    const m = entry.trim().match(/^(?:\(max-width:\s*([\d.]+)(px|rem)\)\s+)?(.+)$/);
    if (!m) throw new Error(`unreadable sizes entry: ${entry}`);
    const [, max, maxUnit, length] = m;
    if (max && viewport > toPx(max, maxUnit!)) continue;
    const calc = length!.match(/^calc\((\d+)vw - ([\d.]+)(px|rem)\)$/);
    if (calc) return (viewport * Number(calc[1])) / 100 - toPx(calc[2]!, calc[3]!);
    const fixed = length!.match(/^([\d.]+)(px|rem)$/);
    if (fixed) return toPx(fixed[1]!, fixed[2]!);
    throw new Error(`unreadable sizes length: ${length}`);
  }
  throw new Error(`no sizes entry matches ${viewport} px: ${sizes}`);
}
/** The candidate a browser picks: the narrowest that covers the drawn width at the density, or the widest. */
function pickedWidth(img: Element, viewport: number, dpr: number): number {
  const need = drawnWidth(img.getAttribute("sizes") ?? "", viewport) * dpr;
  const widths = (img.getAttribute("srcset") ?? "")
    .split(",")
    .map((c) => Number(c.trim().split(/\s+/)[1]?.replace("w", "")))
    .sort((a, b) => a - b);
  return widths.find((w) => w >= need) ?? widths.at(-1)!;
}

/** How wide the map's column draws, from Where.astro's grid: .wrap alone up to 960 px; past it, 13 of 23 parts of .wrap less the gap. */
function columnWidth(viewport: number): number {
  const wrap = Math.min(viewport - 48, 1180);
  return viewport <= 960 ? wrap : ((wrap - 48) * 13) / 23;
}

describe("home leads with the Colorado map", () => {
  it("puts the map's band right after the hero", () => {
    expect(bands[0]?.matches("section.hero"), "the hero first").toBe(true);
    expect(bands[1]?.querySelector("figure#home-map"), "the map's band second").not.toBeNull();
    expect(bands[1]?.querySelector("table[data-zone-counts]"), "with the regions' counts beside the map").not.toBeNull();
  });

  it("makes the map's relief the first image in main", () => {
    expect(main.querySelector("img")).toBe(relief);
  });

  it("draws one statewide map and one table of its counts", () => {
    // A statewide map is a full ColoradoMap with no zone; each Why Colorado
    // panel's map is zoomed to its region (data-zone).
    expect(main.querySelectorAll(".colorado-map:not([data-zone])")).toHaveLength(1);
    expect(main.querySelectorAll(".colorado-map svg[aria-label^='Map of Colorado']")).toHaveLength(1);
    expect(main.querySelectorAll("table[data-zone-counts]")).toHaveLength(1);
  });

  it("loads only the map's relief eagerly, at high priority", () => {
    const imgs = [...main.querySelectorAll("img")];
    const eager = imgs.filter((img) => img.getAttribute("loading") !== "lazy");
    expect(eager).toEqual([relief]);
    expect(relief.getAttribute("fetchpriority")).toBe("high");
    expect(Number(relief.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(relief.getAttribute("height"))).toBeGreaterThan(0);
    for (const img of imgs.filter((i) => i !== relief)) expect(img.getAttribute("fetchpriority"), img.getAttribute("src") ?? "").not.toBe("high");
  });

  // The mobile lab loads at 412 px and 1.75x (l5b/region-art-sizes.test.ts);
  // a laptop at 1280 px and 1x or 2x.
  it.each([
    [412, 1.75, 640],
    [1280, 1, 640],
    [1280, 2, 1280],
  ])("asks for a relief file no narrower than the map draws, at %i px and %fx", (viewport, dpr, file) => {
    expect(drawnWidth(relief.getAttribute("sizes")!, viewport), "sizes covers the column").toBeGreaterThanOrEqual(columnWidth(viewport));
    expect(drawnWidth(relief.getAttribute("sizes")!, viewport) - columnWidth(viewport), "and is no more than 8 px over it").toBeLessThanOrEqual(8);
    expect(pickedWidth(relief, viewport, dpr)).toBe(file);
  });

  it("keeps the sizes over the column at every width in between", () => {
    for (let viewport = 320; viewport <= 1600; viewport += 4) {
      const over = drawnWidth(relief.getAttribute("sizes")!, viewport) - columnWidth(viewport);
      expect(over, `${viewport} px`).toBeGreaterThanOrEqual(0);
      expect(over, `${viewport} px`).toBeLessThanOrEqual(8);
    }
  });
});

describe("Golden's painting, an accent at the end", () => {
  it("sits in the Keepers band, the last, and not in the first two bands", () => {
    expect(painting).not.toBeNull();
    expect(painting.closest("section")).toBe(bands.at(-1)!);
    expect(bands.at(-1)!.matches("section.keepers")).toBe(true);
    for (const band of bands.slice(0, 2)) expect(band.querySelector('[data-art="brand/golden"]')).toBeNull();
  });

  it("loads lazily, never at high priority, with the brand's alt and a plain one-line label", () => {
    expect(painting.getAttribute("loading")).toBe("lazy");
    expect(painting.getAttribute("fetchpriority")).not.toBe("high");
    expect(painting.getAttribute("alt")).toBe(HALL_ART_ALT);
    const label = (painting.closest("figure")?.querySelector("figcaption")?.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(label).toMatch(/^[A-Z][^.!?]*\.$/);
    expect(label).toContain("Golden");
  });
});
