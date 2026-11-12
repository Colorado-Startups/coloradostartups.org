// L2: the Leaderboard charts' phone versions draw their text at the type
// scale's smallest step (#329). Drawn size is computed, not guessed: a chart
// shown at its own width draws its 15-unit text at 15 px, and these are drawn
// 312 units wide, which fits a 360 px phone inside the page's 24 px gutters.
// Label widths are bounded at 0.55 em a character (map labels measured 0.47
// em in Chrome at 375 px).
import { readdirSync, readFileSync } from "node:fs";

import { CompanySchema, EditionSchema } from "@cs/shared";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { buildBoard, countBy, latestEdition } from "../../../src/lib/leaderboard/board";

import {
  foundingTimelineNarrow,
  hqMapNarrow,
  NARROW_WIDTH,
  sectorBarsNarrow,
} from "../../../src/lib/leaderboard/charts";
import { COLORADO_PLACES, isColoradoCity } from "../../../src/lib/leaderboard/places";

const EM = 15;
const GUTTERS = 48; // global.css .wrap: 100% - 2 * --s-5
const text = { label: "A chart", description: "What the chart shows." };
const parse = (svg: string) => new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;

// Shapes like the 2026 edition: Denver 40, Boulder 31, Colorado Springs 6, and
// the longest sector name.
const cities = [
  { key: "Denver", count: 40 },
  { key: "Boulder", count: 31 },
  { key: "Colorado Springs", count: 6 },
  { key: "Centennial", count: 4 },
  { key: "Golden", count: 4 },
];
const sectors = [
  { key: "Software", count: 16 },
  { key: "Travel, hospitality and events", count: 4 },
  { key: "Nonprofit and community", count: 2 },
];
const years = Array.from({ length: 30 }, (_, i) => ({ year: 1996 + i, count: (i % 7) + 1 }));

const charts = {
  hqMapNarrow: parse(hqMapNarrow(cities, text)),
  sectorBarsNarrow: parse(sectorBarsNarrow(sectors, text)),
  foundingTimelineNarrow: parse(foundingTimelineNarrow(years, text)),
};

/** One translate's x or y, 0 when absent. */
const shift = (attr: string | null | undefined, axis: 0 | 1) =>
  Number(/translate\(([-\d.]+),([-\d.]+)\)/.exec(attr ?? "")?.[axis + 1] ?? 0);
const at = (t: Element, axis: 0 | 1) => shift(t.getAttribute("transform"), axis) + shift(t.parentElement?.getAttribute("transform"), axis);

describe("Leaderboard phone charts", () => {
  it("self-test: adds a text's translate to its group's", () => {
    const root = parse('<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(-9,4)"><text transform="translate(20,30)">a</text></g></svg>');
    const t = root.querySelector("text")!;
    expect([at(t, 0), at(t, 1)]).toEqual([11, 34]);
  });

  it("fit a 360 px phone at their own width, so 15-unit text draws at 15 px", () => {
    expect(NARROW_WIDTH + GUTTERS).toBeLessThanOrEqual(360);
  });

  it.each(Object.entries(charts))("%s is drawn at the phone width, all text at 15 units", (_, root) => {
    expect(root.getAttribute("viewBox")).toMatch(new RegExp(`^0 0 ${NARROW_WIDTH} `));
    expect(root.getAttribute("style")).toContain("font-size: var(--t-step--1)");
    expect([...root.querySelectorAll("[font-size]")]).toEqual([]);
  });

  it.each(Object.entries(charts))("%s keeps every label inside its width", (_, root) => {
    const outside: string[] = [];
    for (const t of root.querySelectorAll("text")) {
      const span = (t.textContent ?? "").length * 0.55 * EM;
      const anchor = t.parentElement?.getAttribute("text-anchor") ?? t.getAttribute("text-anchor") ?? "middle";
      const x = at(t, 0);
      const left = anchor === "start" ? x : anchor === "end" ? x - span : x - span / 2;
      if (left < 0 || left + span > NARROW_WIDTH) outside.push(`${t.textContent} ${Math.round(left)}..${Math.round(left + span)}`);
    }
    expect(outside).toEqual([]);
  });

  // A text's box in the browser is about 1.2 em tall, 0.3 em of it under the
  // baseline. Names end at their baseline (lineAnchor bottom); counts are
  // centered on theirs (0.32em). In the first build a count touched the name
  // above it by about 2 px.
  it("keeps each sector name above its count and its bar", () => {
    const root = charts.sectorBarsNarrow;
    const texts = [...root.querySelectorAll("text")];
    const bars = [...root.querySelectorAll("rect")].filter((r) => r.getAttribute("height"));
    for (const [i, s] of sectors.entries()) {
      const name = texts.find((t) => t.textContent === s.key)!;
      const counts = texts.filter((t) => t.textContent === String(s.count));
      const count = counts.find((t) => Math.abs(at(t, 1) - at(name, 1)) < 30)!;
      const nameBottom = at(name, 1) + 0.3 * EM;
      expect(at(count, 1) - 0.6 * EM, s.key).toBeGreaterThanOrEqual(nameBottom);
      expect(Number(bars[i]!.getAttribute("y")), s.key).toBeGreaterThanOrEqual(nameBottom);
    }
  });

  it("keeps the timeline's axis labels clear of its tick numbers", () => {
    const root = charts.foundingTimelineNarrow;
    const all = [...root.querySelectorAll("text")];
    const yLabel = all.find((t) => t.textContent === "↑ Companies")!;
    const yTicksTop = Math.min(...all.filter((t) => /^\d+$/.test(t.textContent ?? "") && t.getAttribute("y") === "0.32em").map((t) => at(t, 1) - EM / 2));
    expect(at(yLabel, 1) + EM).toBeLessThanOrEqual(yTicksTop);
    const xLabel = all.find((t) => t.textContent === "Year founded")!;
    const xTicksBottom = Math.max(...all.filter((t) => /^\d{4}$/.test(t.textContent ?? "")).map((t) => at(t, 1) + EM));
    expect(at(xLabel, 1) - EM).toBeGreaterThanOrEqual(xTicksBottom);
  });
});

// ChartFigure swaps in the phone version wherever the 720-unit chart would
// draw smaller than its units: below 720 px of content, a 768 px screen.
describe("ChartFigure", () => {
  const FIGURE = readFileSync(new URL("../../../src/components/leaderboard/ChartFigure.astro", import.meta.url), "utf8");

  it("shows the phone version at every width where the wide chart would shrink", () => {
    const rem = Number(/@media\s*\(max-width:\s*([\d.]+)rem\)\s*\{\s*\.plot--wide/.exec(FIGURE)?.[1]);
    expect(rem * 16).toBeGreaterThanOrEqual(720 + GUTTERS);
  });
});

// No label on the phone map covers a city's dot (#355). The map is drawn from
// the latest edition, the way /leaderboard/ builds it. Each label's box is
// bounded at 0.55 em a character and 1.3 em tall, 1 em above the baseline
// and 0.3 em under it (Chrome drew these labels 1.17 em tall at 375 px); the
// baseline sits where Plot's line anchor puts it (y="0.32em" middle, "0.71em"
// top, none bottom). In Chrome a 9-unit drop under the Colorado Springs dot
// still touched it; 11 clears it.
describe("the phone HQ map's labels", () => {
  const DATA = new URL("../../../../data/leaderboard/", import.meta.url);
  const load = <T>(dir: string, schema: { parse(v: unknown): T }): T[] =>
    readdirSync(new URL(dir, DATA))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => schema.parse(parseYaml(readFileSync(new URL(`${dir}${f}`, DATA), "utf8"), { version: "1.1" })));
  const edition = latestEdition(load("editions/", EditionSchema))!;
  const rows = buildBoard(edition, load("companies/", CompanySchema));
  const cities = countBy(rows, (r) => r.company.hq_city).filter((c) => isColoradoCity(c.key));

  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
  const covers = (b: Box, cx: number, cy: number, r: number) => {
    const dx = cx - Math.max(b.left, Math.min(cx, b.right));
    const dy = cy - Math.max(b.top, Math.min(cy, b.bottom));
    return dx * dx + dy * dy < r * r;
  };

  function labelBox(t: Element): Box {
    const x = at(t, 0);
    const width = (t.textContent ?? "").length * 0.55 * EM;
    const anchor = t.parentElement?.getAttribute("text-anchor") ?? "middle";
    const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
    const baseline = at(t, 1) + Number(/^([\d.]+)em$/.exec(t.getAttribute("y") ?? "")?.[1] ?? 0) * EM;
    return { left, right: left + width, top: baseline - EM, bottom: baseline + 0.3 * EM };
  }

  it("self-test: finds a circle under a box and passes one beside it", () => {
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(covers(box, 12, 5, 3)).toBe(true);
    expect(covers(box, 14, 5, 3)).toBe(false);
  });

  // Labels come one mark per side (NARROW_SIDE), so page order is not count
  // order: compare the two lists sorted (#369).
  it("names the edition's top three cities", () => {
    const root = parse(hqMapNarrow(cities, text));
    const labels = [...root.querySelectorAll("text")].map((t) => t.textContent ?? "");
    expect(labels.sort()).toEqual(cities.slice(0, 3).map((c) => `${c.key} (${c.count})`).sort());
  });

  it("keeps every label off every city's dot", () => {
    const root = parse(hqMapNarrow(cities, text));
    const dots = [...root.querySelectorAll("circle")].map((c) => ({
      cx: Number(c.getAttribute("cx")) + shift(c.parentElement?.getAttribute("transform"), 0),
      cy: Number(c.getAttribute("cy")) + shift(c.parentElement?.getAttribute("transform"), 1),
      r: Number(c.getAttribute("r")),
    }));
    expect(dots.length).toBe(cities.filter((c) => c.key in COLORADO_PLACES).length);
    const covered: string[] = [];
    for (const t of root.querySelectorAll("text")) {
      const box = labelBox(t);
      const hit = dots.filter((d) => covers(box, d.cx, d.cy, d.r)).length;
      if (hit > 0) covered.push(`${t.textContent} covers ${hit} dot(s)`);
    }
    expect(covered).toEqual([]);
  });
});
