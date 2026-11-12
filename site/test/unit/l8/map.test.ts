// L8: the Front Range map renders in Node, carries its text alternative, and
// uses no `tip` marks (they fail under JSDOM; PLAN.md, Leaderboard).
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { REGIONS } from "../../../src/lib/regions/match";
import { frontRangeMap, mapCities, REGION_COLORS, regionLabelAt } from "../../../src/lib/regions/map";
import { loadGeo } from "../../../src/lib/seats/load";

const text = { label: "Map of the three regions", description: "Fusion Canyon is north; Space Peak is south." };
const svg = frontRangeMap(REGIONS, text);
const doc = new new JSDOM().window.DOMParser().parseFromString(svg, "image/svg+xml");
const root = doc.documentElement;

// A label's width bound, in em a character. The labels measured 0.47 em in
// Chrome at 375 px once the web font loaded. CI's browser drew wider: a
// centered "Longs Peak" ran past the west edge there and not here (#344).
const CHAR_EM = 0.6;

describe("frontRangeMap", () => {
  it("is one labelled image to assistive tech", () => {
    expect(root.tagName).toBe("svg");
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe(text.label);
    expect(root.getAttribute("aria-description")).toBe(text.description);
    expect([...root.querySelectorAll("[aria-label]")]).toEqual([]);
  });

  it("names every core city on the map and in a tooltip", () => {
    const titles = [...root.querySelectorAll("title")].map((t) => t.textContent);
    for (const r of REGIONS) {
      for (const city of r.cities) {
        expect(svg).toContain(`>${city}<`);
        expect(titles).toContain(`${city}, ${r.name}`);
      }
      expect(svg).toContain(`>${r.name}<`);
    }
  });

  it("colors each region with its own token", () => {
    for (const color of Object.values(REGION_COLORS)) expect(svg).toContain(color);
    expect(new Set(Object.values(REGION_COLORS)).size).toBe(3);
  });

  it("uses no tip marks and ships no script", () => {
    expect(svg).not.toMatch(/plot-tip|<script/);
  });

  // Every size comes from the type scale's tokens, never a pixel number (#120).
  it("sets its text in type scale tokens", () => {
    expect(root.getAttribute("style")).toContain("font-size: var(--t-step--1)");
    const sizes = [...root.querySelectorAll("[font-size]")].map((el) => el.getAttribute("font-size"));
    expect(new Set(sizes)).toEqual(new Set(["var(--t-step-0)"]));
    const names = [...root.querySelectorAll("text[font-size]")].map((t) => t.textContent);
    expect(names.sort()).toEqual(REGIONS.map((r) => r.name).sort());
  });

  // A west or east name runs past the map's edge at a phone's label size (#248).
  it("centers every region's name below its cities", () => {
    const names = [...root.querySelectorAll("text[font-size]")];
    expect(names).toHaveLength(REGIONS.length);
    for (const t of names) expect(t.closest("[text-anchor]")?.getAttribute("text-anchor"), t.textContent ?? "").toBe("middle");
  });

  // Every label stays inside the map at a phone's label sizes
  // (regions/index.astro: 21 units, 24 for region names), at CHAR_EM a
  // character. Before #328 "Colorado Springs" was labelled east of its dot and
  // ran past the east edge.
  it("keeps every label inside the map at phone label sizes", () => {
    const width = Number(root.getAttribute("viewBox")?.split(" ")[2]);
    const x = (attr: string | null) => Number(/translate\(([-\d.]+),/.exec(attr ?? "")?.[1] ?? 0);
    const outside: string[] = [];
    for (const t of root.querySelectorAll("text")) {
      const g = t.parentElement!;
      const at = x(t.getAttribute("transform")) + x(g.getAttribute("transform"));
      const span = (t.textContent ?? "").length * CHAR_EM * (t.hasAttribute("font-size") ? 24 : 21);
      const anchor = g.getAttribute("text-anchor") ?? "middle";
      const left = anchor === "start" ? at : anchor === "end" ? at - span : at - span / 2;
      if (left < 0 || left + span > width) outside.push(`${t.textContent} ${Math.round(left)}..${Math.round(left + span)}`);
    }
    expect(outside).toEqual([]);
  });

  // No label covers a peak's triangle at a phone's label sizes, its own name
  // included. A label's box is CHAR_EM a character wide and 1.2 em tall: 0.9
  // em above its baseline and 0.3 below, the baseline where Plot's line
  // anchor puts it (y="0.32em" middle, "0.71em" top). A triangle (r 5) is
  // bounded at 6 units each way. Above its dot, "Colorado Springs" ran over
  // Pikes Peak, and at a phone's size each peak's centered name grew into its
  // own triangle (review of #344).
  it("keeps every label off the peak markers at phone label sizes", () => {
    const shift = (attr: string | null | undefined) => {
      const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(attr ?? "");
      return m ? [Number(m[1]), Number(m[2])] : [0, 0];
    };
    const markers = [...root.querySelectorAll("path")]
      .filter((p) => p.querySelector("title") && !(p.querySelector("title")?.textContent ?? "").includes(","))
      .map((p) => {
        const [x, y] = shift(p.getAttribute("transform"));
        return { name: p.querySelector("title")!.textContent, box: [x - 6, y - 6, x + 6, y + 6] };
      });
    expect(markers.map((m) => m.name)).toEqual(["Longs Peak", "Pikes Peak"]);
    const covering: string[] = [];
    for (const t of root.querySelectorAll("text")) {
      const g = t.parentElement!;
      const [tx, ty] = shift(t.getAttribute("transform"));
      const [gx, gy] = shift(g.getAttribute("transform"));
      const size = t.hasAttribute("font-size") ? 24 : 21;
      const span = (t.textContent ?? "").length * CHAR_EM * size;
      const anchor = g.getAttribute("text-anchor") ?? "middle";
      const x = tx + gx;
      const left = anchor === "start" ? x : anchor === "end" ? x - span : x - span / 2;
      const baseline = ty + gy + Number(/^([\d.]+)em$/.exec(t.getAttribute("y") ?? "")?.[1] ?? 0) * size;
      const box = [left, baseline - 0.9 * size, left + span, baseline + 0.3 * size];
      for (const m of markers) {
        if (box[0]! < m.box[2]! && m.box[0]! < box[2]! && box[1]! < m.box[3]! && m.box[1]! < box[3]!) covering.push(`${t.textContent} over ${m.name}`);
      }
    }
    expect(covering).toEqual([]);
  });

  it("marks the peaks data/positions/geo.yaml lists", () => {
    // City tooltips read "<city>, <region>"; a peak's is its name alone.
    const peaks = [...root.querySelectorAll("title")].map((t) => t.textContent ?? "").filter((t) => !t.includes(","));
    expect(peaks).toEqual(loadGeo().peaks.map((p) => p.name));
    expect(peaks).toEqual(["Longs Peak", "Pikes Peak"]);
  });
});

// The mountain front (#247): a line in --c-border (3:1 or better on ground
// and surface) between the Mountains and Plains notes, west of every core
// city and clear of its dot, that no label touches at a phone's label sizes. Label boxes are bounded as above: CHAR_EM a character
// wide, 0.9 em above the baseline and 0.3 em below, at 21 units (24 for a
// region name). A box must clear the line's centre by CLEAR: half the line's
// 3-unit stroke plus half the widest label halo, a region name's 5 units.
describe("the mountain front", () => {
  const CLEAR = 1.5 + 2.5;
  type Pt = readonly [number, number];
  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
  const translate = (attr: string | null | undefined): Pt => {
    const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(attr ?? "");
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
  };
  /** A path's subpaths as point lists: Plot.line starts a new "M" after a gap. */
  const subpaths = (d: string): Pt[][] =>
    d
      .split("M")
      .filter(Boolean)
      .map((part) => [...part.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const));
  const segments = (paths: Pt[][]): [Pt, Pt][] => paths.flatMap((p) => p.slice(1).map((b, i) => [p[i]!, b] as [Pt, Pt]));
  /** Every x where the line crosses height y. */
  const xsAt = (segs: [Pt, Pt][], y: number) =>
    segs.filter(([a, b]) => (y - a[1]) * (y - b[1]) <= 0 && a[1] !== b[1]).map(([a, b]) => a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  /** Whether a segment enters a box (Liang-Barsky clipping). */
  const enters = ([a, b]: [Pt, Pt], box: Box) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    let t0 = 0;
    let t1 = 1;
    for (const [p, q] of [
      [-dx, a[0] - box.left],
      [dx, box.right - a[0]],
      [-dy, a[1] - box.top],
      [dy, box.bottom - a[1]],
    ] as const) {
      if (p === 0) {
        if (q < 0) return false;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
    return true;
  };
  const labelBox = (t: Element): Box => {
    const g = t.parentElement!;
    const [tx, ty] = translate(t.getAttribute("transform"));
    const [gx, gy] = translate(g.getAttribute("transform"));
    const size = t.hasAttribute("font-size") ? 24 : 21;
    const span = (t.textContent ?? "").length * CHAR_EM * size;
    const anchor = g.getAttribute("text-anchor") ?? "middle";
    const x = tx + gx;
    const left = anchor === "start" ? x : anchor === "end" ? x - span : x - span / 2;
    const baseline = ty + gy + Number(/^([\d.]+)em$/.exec(t.getAttribute("y") ?? "")?.[1] ?? 0) * size;
    return { left, right: left + span, top: baseline - 0.9 * size, bottom: baseline + 0.3 * size };
  };
  const grow = (b: Box, by: number): Box => ({ left: b.left - by, right: b.right + by, top: b.top - by, bottom: b.bottom + by });

  const fronts = [...root.querySelectorAll("g[stroke='var(--c-border)'] path")];
  const front = segments(
    fronts.flatMap((p) => {
      const [gx, gy] = translate(p.parentElement?.getAttribute("transform"));
      return subpaths(p.getAttribute("d") ?? "").map((path) => path.map(([x, y]) => [x + gx, y + gy] as const));
    }),
  );
  /** The shortest distance from a point to a segment. */
  const distance = ([px, py]: Pt, [a, b]: [Pt, Pt]) => {
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy);
  };
  const cityDots = [...root.querySelectorAll("circle")]
    .filter((c) => (c.querySelector("title")?.textContent ?? "").includes(","))
    .map((c) => {
      const [gx, gy] = translate(c.parentElement?.getAttribute("transform"));
      return { name: c.querySelector("title")!.textContent!.split(",")[0]!, x: Number(c.getAttribute("cx")) + gx, y: Number(c.getAttribute("cy")) + gy };
    });

  it("self-test: splits a path at its gaps and finds where a segment enters a box", () => {
    const segs = segments(subpaths("M0,0L10,10M20,20L20,30"));
    expect(segs).toEqual([
      [
        [0, 0],
        [10, 10],
      ],
      [
        [20, 20],
        [20, 30],
      ],
    ]);
    expect(xsAt(segs, 5)).toEqual([5]);
    expect(xsAt(segs, 15)).toEqual([]);
    const box = { left: 4, top: 0, right: 6, bottom: 2 };
    expect(enters(segs[0]!, box)).toBe(false);
    expect(enters(segs[0]!, { ...box, top: 4, bottom: 6 })).toBe(true);
    expect(enters(segs[1]!, { left: 19, top: 0, right: 21, bottom: 21 })).toBe(true);
    expect(enters(segs[1]!, { left: 21, top: 0, right: 30, bottom: 40 })).toBe(false);
    expect(distance([5, 0], segs[0]!)).toBeCloseTo(Math.SQRT2 * 2.5);
    expect(distance([20, 35], segs[1]!)).toBe(5);
  });

  // --c-stone-edge is a decoration token, 1.92:1 on the band's surface.
  it("is one line in the border token", () => {
    expect(fronts).toHaveLength(1);
    expect(front.length).toBeGreaterThan(3);
  });

  it("runs between the Mountains and Plains notes", () => {
    const note = (label: string) => labelBox([...root.querySelectorAll("text")].find((t) => t.textContent === label)!);
    for (const [label, side] of [
      ["Mountains", "west"],
      ["Plains", "east"],
    ] as const) {
      const box = note(label);
      const xs = [box.top, box.bottom].flatMap((y) => xsAt(front, y));
      expect(xs, label).toHaveLength(2);
      for (const x of xs) {
        if (side === "west") expect(box.right + CLEAR, label).toBeLessThanOrEqual(x);
        else expect(box.left - CLEAR, label).toBeGreaterThanOrEqual(x);
      }
    }
  });

  it("runs west of every core city", () => {
    expect(cityDots).toHaveLength(mapCities(REGIONS).length);
    for (const dot of cityDots) {
      const xs = xsAt(front, dot.y);
      expect(xs, dot.name).toHaveLength(1);
      expect(xs[0]!, dot.name).toBeLessThan(dot.x);
    }
  });

  // A dot is 6 units with a 2-unit ring, and the line's stroke is 3 units, so
  // a center 8.5 units away keeps the ring off the stroke. At the Wikipedia
  // points the line ran under Boulder's and Golden's dots (review of #482).
  it("keeps every core city's dot and ring off its stroke", () => {
    const CENTER_CLEAR = 6 + 2 / 2 + 3 / 2;
    const near = cityDots
      .map((d) => ({ name: d.name, gap: Math.min(...front.map((seg) => distance([d.x, d.y], seg))) }))
      .filter((d) => d.gap < CENTER_CLEAR)
      .map((d) => `${d.name} ${d.gap.toFixed(2)}`);
    expect(near).toEqual([]);
  });

  it("keeps every label clear of it at phone label sizes", () => {
    expect(front.length).toBeGreaterThan(0);
    const touching = [...root.querySelectorAll("text")]
      .filter((t) => front.some((seg) => enters(seg, grow(labelBox(t), CLEAR))))
      .map((t) => t.textContent);
    expect(touching).toEqual([]);
  });

  // A label moved off the front must not land on a neighbor: east of its dot,
  // Loveland's first ran into Greeley's. A dot is 6 units with a 2-unit ring.
  it("keeps every label off every other city's dot at phone label sizes", () => {
    const covered: string[] = [];
    for (const t of root.querySelectorAll("text")) {
      const b = labelBox(t);
      for (const d of cityDots.filter((d) => d.name !== t.textContent)) {
        const dx = d.x - Math.max(b.left, Math.min(d.x, b.right));
        const dy = d.y - Math.max(b.top, Math.min(d.y, b.bottom));
        if (dx * dx + dy * dy < 7 * 7) covered.push(`${t.textContent} over ${d.name}`);
      }
    }
    expect(covered).toEqual([]);
  });
});

describe("mapCities", () => {
  it("lists the core cities only, with their region", () => {
    expect(mapCities(REGIONS).map((c) => `${c.city}:${c.region}`)).toEqual([
      "Boulder:photon-mountain",
      "Golden:photon-mountain",
      "Arvada:photon-mountain",
      "Denver:photon-mountain",
      "Colorado Springs:space-peak",
      "Fort Collins:fusion-canyon",
      "Loveland:fusion-canyon",
      "Windsor:fusion-canyon",
      "Greeley:fusion-canyon",
    ]);
  });

  it("fails loudly on a core city the map cannot place", () => {
    const bad = [{ ...REGIONS[1]!, cities: ["Atlantis"] }];
    expect(() => mapCities(bad)).toThrow(/cannot place on the map/);
  });
});

describe("regionLabelAt", () => {
  const cities = mapCities(REGIONS).filter((c) => c.region === "fusion-canyon");

  it("puts a west label left of the westernmost city and a south label below the southernmost", () => {
    const west = regionLabelAt(cities, "west");
    expect(west.lon).toBeLessThan(Math.min(...cities.map((c) => c.lon)));
    const south = regionLabelAt(cities, "south");
    expect(south.lat).toBeLessThan(Math.min(...cities.map((c) => c.lat)));
  });
});
