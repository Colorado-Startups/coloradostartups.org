// Leaderboard charts, rendered to SVG strings at build time through
// lib/plot.ts (Plot in a JSDOM document, no `tip` marks, no client JavaScript).
//
// Colors are existing brand tokens only (CSS variables resolve in inline SVG).
// The Gate A v2 design pass restyles these; the data and structure stay.

import * as Plot from "@observablehq/plot";

import { renderPlot as render, type ChartText } from "../plot";
import type { Count, YearCount } from "./board";
import { COLORADO_OUTLINE, COLORADO_PLACES } from "./places";

const MARK = "var(--c-accent)";
const LINE = "var(--c-rule)";
// The HQ maps' state outline and dot edges (#240). The charts sit on the
// surface band. brand_tokens.yaml lists border on surface at 4.11:1 and
// text-dim on surface at 7.96:1, both past the 3:1 a graphic needs; rule, the
// old color of both, is not in its contrast block. The dots keep their gold
// fill, and the dark edge is what meets 3:1.
const OUTLINE = "var(--c-border)";
const DOT_EDGE = "var(--c-text-dim)";

/** The HQ cities the state map can place, with their positions. */
const hqPoints = (cities: readonly Count[]) =>
  cities
    .filter((c) => Object.hasOwn(COLORADO_PLACES, c.key))
    .map((c) => ({ city: c.key, count: c.count, ...COLORADO_PLACES[c.key]! }));

/** HQ cities in Colorado as dots on the state outline, sized by company count. */
export function hqMap(cities: readonly Count[], text: ChartText, labelTop = 3): string {
  const points = hqPoints(cities);
  const labelled = points.slice(0, labelTop);
  return render({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: 720,
    height: 520,
    projection: { type: "mercator", domain: COLORADO_OUTLINE, inset: 12 },
    r: { range: [3, 22] },
    marks: [
      Plot.geo(COLORADO_OUTLINE, { stroke: OUTLINE, strokeWidth: 1.5 }),
      Plot.dot(points, { x: "lon", y: "lat", r: "count", fill: MARK, fillOpacity: 0.75, stroke: DOT_EDGE }),
      Plot.text(labelled, {
        x: "lon",
        y: "lat",
        text: (d: { city: string; count: number }) => `${d.city} (${d.count})`,
        dx: 14,
        textAnchor: "start",
        fill: "currentColor",
        stroke: "var(--c-ground)",
        strokeWidth: 4,
      }),
    ],
  });
}

/** Companies per sector, largest first. */
export function sectorBars(sectors: readonly Count[], text: ChartText): string {
  return render({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: 720,
    // Plot sets the axis label's baseline at marginBottom - 3, so at the default
    // 30 it sat on the tick numbers (#295). 48 puts it under them; the height
    // grows by the same 18 so each bar keeps its room.
    height: 58 + sectors.length * 26,
    marginLeft: 220,
    marginBottom: 48,
    x: { label: "Companies", grid: true },
    y: { label: null, domain: sectors.map((s) => s.key) },
    marks: [
      Plot.barX(sectors, { x: "count", y: "key", fill: MARK }),
      Plot.text(sectors, { x: "count", y: "key", text: "count", dx: 6, textAnchor: "start", fill: "currentColor" }),
      Plot.ruleX([0], { stroke: LINE }),
    ],
  });
}

/** Companies per founding year, oldest on the left. */
export function foundingTimeline(years: readonly YearCount[], text: ChartText): string {
  const first = years[0]?.year ?? 2000;
  const last = years.at(-1)?.year ?? first;
  const domain = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return render({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: 720,
    // The y label hangs 3 px under the top edge; at the default marginTop of
    // 20 it sat on the top tick number (#295). 32 clears it. The x label sits
    // marginBottom - 3 below the bars, in the tick row at the default 30
    // (#334); 48 puts it under the years, and the height grows by the same 18.
    height: 330,
    marginTop: 32,
    marginBottom: 48,
    x: {
      label: "Year founded",
      type: "band",
      domain,
      tickFormat: (y: number) => (y % 5 === 0 || y === first || y === last ? String(y) : ""),
    },
    y: { label: "Companies", grid: true },
    marks: [Plot.barY(years, { x: "year", y: "count", fill: MARK }), Plot.ruleY([0], { stroke: LINE })],
  });
}

// Phone versions (#329). A 375 px phone shows the 720-unit charts 327 px
// wide, so their 15-unit text drew at 6.8 px. These are drawn 312 units wide
// and shown at their own size (ChartFigure), so on any screen 360 px or wider
// their text draws at 15 px, the smallest step of the type scale.
export const NARROW_WIDTH = 312;

// Where a label sits beside its dot on the phone map; east unless named here.
// Boulder sits just northwest of Denver, so its label goes west. "Colorado
// Springs (6)" is too long for the east side, and to the west it covered two
// smaller dots, so it goes below its dot, where the map is empty (#355).
type NarrowSide = "east" | "west" | "south";
const NARROW_SIDE: Readonly<Record<string, NarrowSide>> = { Boulder: "west", "Colorado Springs": "south" };
const NARROW_PLACE: Readonly<Record<NarrowSide, Pick<Plot.TextOptions, "dx" | "dy" | "textAnchor" | "lineAnchor">>> = {
  east: { dx: 14, textAnchor: "start" },
  west: { dx: -14, textAnchor: "end" },
  south: { dy: 11, textAnchor: "middle", lineAnchor: "top" },
};

/** hqMap for phones: the same dots, with each label placed where it fits. */
export function hqMapNarrow(cities: readonly Count[], text: ChartText, labelTop = 3): string {
  const points = hqPoints(cities);
  const labelled = points.slice(0, labelTop);
  const label = (side: NarrowSide) =>
    Plot.text(
      labelled.filter((p) => (NARROW_SIDE[p.city] ?? "east") === side),
      {
        x: "lon",
        y: "lat",
        text: (d: { city: string; count: number }) => `${d.city} (${d.count})`,
        ...NARROW_PLACE[side],
        fill: "currentColor",
        stroke: "var(--c-ground)",
        strokeWidth: 4,
      },
    );
  return render({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: NARROW_WIDTH,
    height: 236,
    projection: { type: "mercator", domain: COLORADO_OUTLINE, inset: 8 },
    r: { range: [2, 11] },
    marks: [
      Plot.geo(COLORADO_OUTLINE, { stroke: OUTLINE, strokeWidth: 1.5 }),
      Plot.dot(points, { x: "lon", y: "lat", r: "count", fill: MARK, fillOpacity: 0.75, stroke: DOT_EDGE }),
      label("east"),
      label("west"),
      label("south"),
    ],
  });
}

/**
 * sectorBars for phones: each sector's name sits above its bar and its count
 * at the bar's end, so no margin has to hold the names. Every bar carries its
 * count, so the chart needs no x axis.
 */
export function sectorBarsNarrow(sectors: readonly Count[], text: ChartText): string {
  // Each row is 48 units: the name's line ends 4 units above the row's middle,
  // and the bar and its count sit 2 units below it, so a count at the end of
  // a short bar never touches the name above it.
  const ROW = 48;
  return render({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: NARROW_WIDTH,
    height: 8 + sectors.length * ROW,
    marginTop: 4,
    marginBottom: 4,
    marginLeft: 0,
    marginRight: 30,
    x: { axis: null },
    y: { axis: null, domain: sectors.map((s) => s.key), padding: 0 },
    marks: [
      Plot.barX(sectors, { x: "count", y: "key", fill: MARK, insetTop: ROW / 2 + 2, insetBottom: 4 }),
      Plot.text(sectors, { x: 0, y: "key", text: "key", textAnchor: "start", lineAnchor: "bottom", dy: -4, fill: "currentColor" }),
      Plot.text(sectors, { x: "count", y: "key", text: "count", dx: 6, dy: 11, textAnchor: "start", fill: "currentColor" }),
      Plot.ruleX([0], { stroke: LINE }),
    ],
  });
}

/** foundingTimeline for phones: a year label each decade, axis labels clear of the ticks (#295). */
export function foundingTimelineNarrow(years: readonly YearCount[], text: ChartText): string {
  const first = years[0]?.year ?? 2000;
  const last = years.at(-1)?.year ?? first;
  const domain = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return render({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: NARROW_WIDTH,
    height: 272,
    marginTop: 32,
    marginBottom: 48,
    x: { label: "Year founded", type: "band", domain, tickFormat: (y: number) => (y % 10 === 0 ? String(y) : "") },
    y: { label: "Companies", grid: true },
    marks: [Plot.barY(years, { x: "year", y: "count", fill: MARK }), Plot.ruleY([0], { stroke: LINE })],
  });
}
