// The map drawn at build time, as an SVG with no JavaScript. It lies over a
// shaded-relief image of the same frame (ColoradoMap.astro), and it is what a
// visitor sees before the live map (MapLibre) loads over it.
//
// Three kinds of view, each a frame in data/geo/views.json:
//   state        Colorado: the highways, the three zones in their region colors,
//                the cities on their corners, the zone names, two peaks.
//   zone-<id>    one zone: its highways, the roads its line follows by name,
//                its cities by name, its nearby towns as dots.
//   thumb-<id>   the same zone at 16:9 with a state locator, for a card header.
//
// Every view is Web Mercator, as the relief image and the live map are, so the
// three line up. Colors are tokens, never a hex, so the map follows the theme.
import * as Plot from "@observablehq/plot";

import type { RegionId } from "@cs/shared";

import { renderPlot, type ChartText } from "../plot";
import { loadGeo } from "../seats/load";
import { COLORADO, ZONES, zoneLabelPoint, type CityPoint, type LonLat, type ZoneFeature } from "./colorado-geo";
import { frameMiles, HIGHWAYS, inFrame, LOOP_ROADS, VIEWS, type Frame, type Highway, type ViewId } from "./colorado-views";
import { REGION_COLORS } from "./map";

/** Twice the signed area of a lon/lat ring: positive when it runs counterclockwise. */
export function signedArea(ring: readonly LonLat[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a;
}

// d3-geo, under Plot, reads winding the opposite way from GeoJSON (RFC 7946):
// an exterior ring must run clockwise, or it fills the whole globe except the
// shape, and the projection fits the globe. data/geo/ keeps RFC order, which
// MapLibre reads; the drawing reverses each counterclockwise ring.
export function clockwise<F extends { geometry: { coordinates: LonLat[][] } }>(feature: F): F {
  const coordinates = feature.geometry.coordinates.map((r) => (signedArea(r) > 0 ? [...r].reverse() : r));
  return { ...feature, geometry: { ...feature.geometry, coordinates } };
}

export const MAP_WIDTH = VIEWS.state.width;
export const MAP_HEIGHT = VIEWS.state.height;

export interface MapView {
  /** Zoom to one zone. Omit for the whole state. */
  zone?: RegionId;
  /** "thumb": the zone at 16:9 with a state locator, for a card header. Needs `zone`. */
  variant?: "full" | "thumb";
}

/** The frame a view draws in: data/geo/views.json. */
export function viewOf({ zone, variant }: MapView = {}): { id: ViewId; frame: Frame } {
  const id: ViewId = zone ? (variant === "thumb" ? `thumb-${zone}` : `zone-${zone}`) : "state";
  return { id, frame: VIEWS[id] };
}

const TEXT = "var(--c-text)";
const DIM = "var(--c-text-dim)";
const GROUND = "var(--c-ground)";
// Plot reads a fontSize string as a field name unless it looks like "18px", so
// a token goes in as a constant channel.
const token = (name: string) => () => `var(${name})`;
const halo = { stroke: GROUND, strokeWidth: 4, paintOrder: "stroke" } as const;

const ROAD: Record<Highway["kind"], { strokeWidth: number; strokeOpacity: number }> = {
  state: { strokeWidth: 0.7, strokeOpacity: 0.4 },
  us: { strokeWidth: 0.9, strokeOpacity: 0.5 },
  interstate: { strokeWidth: 1.7, strokeOpacity: 0.75 },
};
const ROAD_ORDER: Highway["kind"][] = ["state", "us", "interstate"];

// Where the statewide map names an interstate: the point on its line nearest each of these.
const INTERSTATE_LABELS: [string, LonLat][] = [
  ["I-25", [-104.75, 37.72]],
  ["I-70", [-107.75, 39.55]],
  ["I-76", [-102.65, 40.85]],
];
// A loop's road is named on its line when it runs at least this far: a two-mile link is too short to carry a name.
const NAMED_ROAD_MI = 3;
const SCALE_BAR_MI = { state: 100, zone: 5 };

const inside = (f: Frame, [lon, lat]: LonLat) => lon > f.west && lon < f.east && lat > f.south && lat < f.north;
const milesBetween = (a: LonLat, b: LonLat) => Math.hypot((a[0] - b[0]) * 69.172 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 68.71);
const lineMiles = (line: readonly LonLat[]) => line.slice(1).reduce((sum, p, i) => sum + milesBetween(line[i]!, p), 0);

function nearest(lines: readonly LonLat[][], to: LonLat): LonLat {
  let best = lines[0]![0]!;
  for (const line of lines) for (const p of line) if (milesBetween(p, to) < milesBetween(best, to)) best = p;
  return best;
}

/** A zone's three strokes: a soft glow, a dark casing so a light color holds on light ground, and the line itself. */
function zoneMarks(z: ZoneFeature, focus: boolean): Plot.Markish[] {
  const shape = clockwise(z);
  const color = REGION_COLORS[z.id];
  const line = { fill: "none", strokeLinejoin: "round", clip: "frame" } as const;
  return [
    Plot.geo(shape, { ...line, stroke: color, strokeWidth: focus ? 13 : 9, strokeOpacity: 0.22 }),
    Plot.geo(shape, { ...line, stroke: "var(--c-night)", strokeWidth: focus ? 5.5 : 4.5, strokeOpacity: 0.6 }),
    Plot.geo(shape, { ...line, fill: color, fillOpacity: 0.18, stroke: color, strokeWidth: focus ? 3 : 2.5 }),
  ];
}

// ---- Label layout: no name over another name, over a dot, or off the frame ----
// e2e/l8.spec.ts checks the same three rules in a real browser.

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
type Px = [number, number];
/** A bold character's width in em: a little wide on purpose, so a real font never runs past its box. */
const CHAR_EM = 0.62;
/** The type scale's two smallest steps, in px (styles/tokens.css): names of places, then everything else. */
export const NAME_PX = 18;
export const SMALL_PX = 15;

const toPx = (frame: Frame, p: LonLat): Px => {
  const [x, y] = inFrame(frame, p);
  return [x * frame.width, y * frame.height];
};
function textBox([x, y]: Px, text: string, size: number, anchor: "start" | "middle" | "end", dx = 0): Box {
  const w = text.length * size * CHAR_EM;
  const left = anchor === "start" ? x + dx : anchor === "end" ? x + dx - w : x - w / 2;
  return { left, right: left + w, top: y - size * 0.62, bottom: y + size * 0.62 };
}
const overlap = (a: Box, b: Box, gap = 3) => a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
const covers = (b: Box, [x, y]: Px, gap = 5) => x > b.left - gap && x < b.right + gap && y > b.top - gap && y < b.bottom + gap;
const inFrameBox = (b: Box, f: Frame, gap = 4) => b.left > gap && b.right < f.width - gap && b.top > gap && b.bottom < f.height - gap;

/** What a view has placed so far: every label's box, and every dot. */
interface Layout {
  frame: Frame;
  boxes: Box[];
  dots: Px[];
}
/** Takes the box when it is clear of the frame's edge, every placed label and every dot but its own. */
function claim(layout: Layout, box: Box, own?: Px): boolean {
  if (!inFrameBox(box, layout.frame) || layout.boxes.some((b) => overlap(b, box)) || layout.dots.some((d) => d !== own && covers(box, d))) return false;
  layout.boxes.push(box);
  return true;
}

/**
 * Each place's name beside its dot: on the side away from `away` (the zone's
 * middle longitude), so a name sits outside the loop, or on the other side
 * when that one is taken. A name with no clear side is left off; the list
 * beside the map still names the place.
 */
function nameMarks(layout: Layout, places: readonly CityPoint[], r: number, away: number, size: number): Plot.Markish[] {
  const sides: Record<"start" | "end", CityPoint[]> = { start: [], end: [] };
  for (const p of places) {
    const at = toPx(layout.frame, [p.lon, p.lat]);
    const own = layout.dots.find((d) => d[0] === at[0] && d[1] === at[1]);
    const first = p.lon < away ? "end" : "start";
    for (const side of [first, first === "end" ? "start" : "end"] as const) {
      if (claim(layout, textBox(at, p.name, size, side, side === "start" ? r + 5 : -(r + 5)), own)) {
        sides[side].push(p);
        break;
      }
    }
  }
  return (["start", "end"] as const).map((anchor) =>
    Plot.text(sides[anchor], {
      x: "lon",
      y: "lat",
      text: "name",
      textAnchor: anchor,
      dx: anchor === "start" ? r + 5 : -(r + 5),
      fontWeight: 700,
      fontSize: token(size === NAME_PX ? "--t-step-0" : "--t-step--1"),
      fill: TEXT,
      ...halo,
    }),
  );
}

/** The point a share of the way along a line, by distance. */
function pointAlong(line: readonly LonLat[], share: number): LonLat {
  let left = lineMiles(line) * share;
  for (let i = 1; i < line.length; i++) {
    const step = milesBetween(line[i - 1]!, line[i]!);
    if (left <= step) {
      const t = step === 0 ? 0 : left / step;
      return [line[i - 1]![0] + (line[i]![0] - line[i - 1]![0]) * t, line[i - 1]![1] + (line[i]![1] - line[i - 1]![1]) * t];
    }
    left -= step;
  }
  return line.at(-1)!;
}

/** Each long road's name on its own line: at its middle, or the nearest clear spot along it. */
function roadNames(layout: Layout, loop: string): { lon: number; lat: number; name: string }[] {
  const named: { lon: number; lat: number; name: string }[] = [];
  for (const road of LOOP_ROADS.filter((r) => r.loop === loop && lineMiles(r.line) >= NAMED_ROAD_MI)) {
    for (const share of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const [lon, lat] = pointAlong(road.line, share);
      if (claim(layout, textBox(toPx(layout.frame, [lon, lat]), road.road, SMALL_PX, "middle"))) {
        named.push({ lon, lat, name: road.road });
        break;
      }
    }
  }
  return named;
}

/** A mile bar in the frame's bottom-left corner. Its label claims its place first, so no name lands on it. */
function scaleBar(layout: Layout, miles: number): Plot.Markish[] {
  const { frame } = layout;
  const lat = frame.south + 0.07 * (frame.north - frame.south);
  const lon = frame.west + 0.04 * (frame.east - frame.west);
  const end = lon + miles / (69.172 * Math.cos((lat * Math.PI) / 180));
  const [x0, y] = toPx(frame, [lon, lat]);
  const [x1] = toPx(frame, [end, lat]);
  layout.boxes.push({ left: x0 - 4, right: x1 + 4, top: y - 26, bottom: y + 6 });
  return [
    Plot.line(
      [
        [lon, lat],
        [end, lat],
      ],
      { stroke: TEXT, strokeWidth: 2, strokeLinecap: "butt" },
    ),
    Plot.text([[(lon + end) / 2, lat]], { text: () => `${miles} mi`, dy: -9, fontWeight: 700, fill: TEXT, ...halo }),
  ];
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A thumbnail's locator: the state in miniature, top right (clear of every city's name), with a dot where the zone is. */
function locator(layout: Layout, zone: ZoneFeature): Plot.Markish {
  const { frame } = layout;
  const [w, h, pad] = [78, 58, 8];
  const state = COLORADO.features[0]!.geometry.coordinates[0]!;
  const lons = state.map((p) => p[0]);
  const lats = state.map((p) => p[1]);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const [x0, y0] = [frame.width - w - pad, pad];
  layout.boxes.push({ left: x0, right: x0 + w, top: y0, bottom: y0 + h });
  const at = ([lon, lat]: LonLat) => [x0 + 6 + ((lon - west) / (east - west)) * (w - 12), y0 + 6 + ((north - lat) / (north - south)) * (h - 12)] as const;
  const ring = zone.geometry.coordinates[0]!;
  const centre = at([ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]);
  return (_index: unknown, _scales: unknown, _values: unknown, _dimensions: unknown, context: { document: Document }) => {
    const el = (name: string, attrs: Record<string, string | number>) => {
      const node = context.document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      return node;
    };
    const g = el("g", {});
    for (const part of [
      el("rect", { x: x0, y: y0, width: w, height: h, rx: 6, fill: GROUND, "fill-opacity": 0.88, stroke: "var(--c-border)", "stroke-width": 1 }),
      el("path", {
        d: `M${state.map((p) => at(p).map((v) => v.toFixed(1)).join(",")).join("L")}Z`,
        fill: "var(--c-surface)",
        stroke: DIM,
        "stroke-width": 1,
      }),
      el("circle", { cx: centre[0].toFixed(1), cy: centre[1].toFixed(1), r: 5, fill: REGION_COLORS[zone.id], stroke: "var(--c-night)", "stroke-width": 1.5 }),
    ]) {
      g.appendChild(part);
    }
    return g;
  };
}

/** The no-JavaScript map: the whole state, one zone's view of it, or that zone's thumbnail. An SVG string. */
export function coloradoMapSvg(text: ChartText, view: MapView = {}): string {
  const { frame } = viewOf(view);
  const focus = ZONES.features.find((z) => z.id === view.zone);
  const thumb = Boolean(focus) && view.variant === "thumb";
  const roads = HIGHWAYS.filter((h) => h.view === (focus?.id ?? "state") && (!thumb || h.kind !== "state"));
  const marks: Plot.Markish[] = [];

  if (!focus) {
    // Dim what lies beyond the state line: the frame, with the state cut out of it.
    const [w, s, e, n] = [frame.west - 2, frame.south - 2, frame.east + 2, frame.north + 2];
    const beyond = { type: "Polygon" as const, coordinates: [[[w, s], [w, n], [e, n], [e, s], [w, s]], COLORADO.features[0]!.geometry.coordinates[0]!] };
    marks.push(
      Plot.geo(beyond, { fill: GROUND, fillOpacity: 0.72, stroke: "none", clip: "frame" }),
      Plot.geo(clockwise(COLORADO.features[0]!), { fill: "none", stroke: "var(--c-border)", strokeWidth: 1.5 }),
    );
  }

  for (const kind of ROAD_ORDER) {
    const lines = roads.filter((h) => h.kind === kind).flatMap((h) => h.lines);
    if (lines.length) marks.push(Plot.geo({ type: "MultiLineString", coordinates: lines }, { fill: "none", stroke: DIM, ...ROAD[kind], clip: "frame" }));
  }

  for (const z of focus ? [focus] : ZONES.features) marks.push(...zoneMarks(z, Boolean(focus)));

  const layout: Layout = { frame, boxes: [], dots: [] };
  if (focus) {
    const towns = focus.properties.townPoints.filter((t) => inside(frame, [t.lon, t.lat]));
    const cities = focus.properties.cityPoints.filter((c) => inside(frame, [c.lon, c.lat]));
    layout.dots = [...towns, ...cities].map((p) => toPx(frame, [p.lon, p.lat]));
    const r = thumb ? 4 : 5;
    const ring = focus.geometry.coordinates[0]!;
    const middle = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    // Order matters: the mile bar and the locator hold their corners, then the cities, then the roads.
    const corner = thumb ? [locator(layout, focus)] : scaleBar(layout, SCALE_BAR_MI.zone);
    const names = nameMarks(layout, cities, r, middle, thumb ? SMALL_PX : NAME_PX);
    marks.push(Plot.dot(towns, { x: "lon", y: "lat", r: 2.5, fill: DIM, stroke: GROUND, strokeWidth: 1, title: "name" }));
    // Name each long road the line follows, on the line.
    if (!thumb) marks.push(Plot.text(roadNames(layout, focus.id), { x: "lon", y: "lat", text: "name", fontWeight: 700, fill: DIM, ...halo }));
    marks.push(Plot.dot(cities, { x: "lon", y: "lat", r, fill: TEXT, stroke: GROUND, strokeWidth: 1.5 }), ...names, ...corner);
  } else {
    const cities = ZONES.features.flatMap((z) => z.properties.cityPoints);
    layout.dots = cities.map((p) => toPx(frame, [p.lon, p.lat]));
    const bar = scaleBar(layout, SCALE_BAR_MI.state);
    // Each zone's name east of it, on the open plains; west of it when that spot is taken.
    const zoneNames = ZONES.features.flatMap((z) => {
      for (const side of ["east", "west"] as const) {
        const [lon, lat] = zoneLabelPoint(z, side);
        const anchor = side === "east" ? "start" : "end";
        if (claim(layout, textBox(toPx(frame, [lon, lat]), z.properties.name, NAME_PX, anchor))) return [{ lon, lat, name: z.properties.name, anchor }];
      }
      return [];
    });
    const peaks = loadGeo().peaks.filter((p) => claim(layout, textBox(toPx(frame, [p.lon, p.lat]), p.name, SMALL_PX, "end", -8)));
    const interstates = INTERSTATE_LABELS.flatMap(([name, near]) => {
      const road = roads.find((h) => h.name === name);
      if (!road) return [];
      const [lon, lat] = nearest(road.lines, near);
      return claim(layout, textBox(toPx(frame, [lon, lat]), name, SMALL_PX, "middle")) ? [{ lon, lat, name }] : [];
    });
    marks.push(
      Plot.text(interstates, { x: "lon", y: "lat", text: "name", fontWeight: 700, fill: DIM, ...halo }),
      Plot.dot(peaks, { x: "lon", y: "lat", r: 4, symbol: "triangle", fill: DIM, stroke: GROUND, strokeWidth: 1 }),
      Plot.text(peaks, { x: "lon", y: "lat", text: "name", textAnchor: "end", dx: -8, fill: DIM, ...halo }),
      Plot.dot(cities, { x: "lon", y: "lat", r: 3, fill: TEXT, stroke: GROUND, strokeWidth: 1.5 }),
      ...(["start", "end"] as const).map((anchor) =>
        Plot.text(
          zoneNames.filter((n) => n.anchor === anchor),
          { x: "lon", y: "lat", text: "name", textAnchor: anchor, fontWeight: 700, fontSize: token("--t-step-0"), fill: TEXT, ...halo },
        ),
      ),
      ...bar,
    );
  }

  return renderPlot({
    width: frame.width,
    height: frame.height,
    margin: 0,
    ariaLabel: text.label,
    ariaDescription: text.description,
    // The frame's two corners fix the view exactly: Mercator turns them into the frame's own rectangle.
    projection: { type: "mercator", domain: { type: "MultiPoint", coordinates: [[frame.west, frame.south], [frame.east, frame.north]] }, inset: 0 },
    marks,
  });
}

/** Miles across a view, for a caption or a test. */
export function viewMiles(view: MapView = {}): number {
  return frameMiles(viewOf(view).frame);
}
