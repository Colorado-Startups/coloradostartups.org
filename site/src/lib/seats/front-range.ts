// The Front Range map on a seat page: one outpost, or all three for the
// Slack seat. One function per layer, drawn in the kit's order (#192):
// the ground and region names here, the marks in map-marks.ts, the numbers
// in map-geometry.ts. viz.ts re-exports frontRangeMap.

import type { Geo, GeoCity } from "./load";
import {
  labelOf,
  leftOf,
  mountains,
  NARROW_ASPECT,
  NARROW_LEAN,
  narrowPeakSide,
  northOf,
  Proj,
  REGION_NAMES,
  REGION_ORDER,
  ridgeLon,
  viewBounds,
  type MapCtx,
  type MapRegion,
} from "./map-geometry";
import { cityMarks, coreLinks, inset, landmarkMarks, northArrow, peakBoxes, peakMarks, utePass } from "./map-marks";
import { andList } from "../text";
import { esc, f1, openSvg, overlaps, SEAT_NARROW_WIDTH, type Box, type FigureOptions } from "./svg";

export type { MapRegion } from "./map-geometry";

// What a phone drawing's region names must stay clear of.
interface Obstacles {
  cityBoxes: Box[];
  townDots: Box[];
  peakMarks: Box[];
  peakLabels: Box[];
}

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * The Front Range map for one outpost, or for all three ("all", the Slack
 * seat's statewide view). Core cities of an outpost are joined by lines so it
 * reads as one place; the inset shows where the view sits in Colorado.
 */
export function frontRangeMap(region: MapRegion, geo: Geo, { narrow = false }: FigureOptions = {}): string {
  const m = mapContext(region, geo, narrow);
  const ob = obstacles(m);
  const taken = peakBoxes(m);
  return [
    ...mapHead(m),
    ...mountainGround(m),
    ...regionMarks(m, ob),
    ...coreLinks(m),
    ...utePass(m),
    ...landmarkMarks(m),
    ...peakMarks(m),
    ...cityMarks(m, taken),
    ...inset(m, taken),
    northArrow(m.pr.W),
    "</svg>",
  ].join("");
}

/** The projection for an outpost's view, or the statewide one. */
function mapProjection(region: MapRegion, cities: readonly GeoCity[], narrow: boolean): Proj {
  if (region === "all") {
    const all = cities.map((c) => [c.lat, c.lon] as const);
    const [west, east, south, north] = narrow
      ? viewBounds([...all, northOf(all)], NARROW_ASPECT.all, 0.22, 0.7, NARROW_LEAN.all)
      : viewBounds(all, 0.95, 0.22, 0.7, 0.12); // room east for the outpost names
    return new Proj(west, east, south, north, narrow ? SEAT_NARROW_WIDTH : 560);
  }
  const focus = cities.filter((c) => c.region === region).map((c) => [c.lat, c.lon] as const);
  if (focus.length === 0) throw new Error(`map: no cities for region ${region}`);
  const [west, east, south, north] = narrow
    ? viewBounds([...focus, northOf(focus)], NARROW_ASPECT.outpost, 0.18, 0.7, NARROW_LEAN.outpost)
    : viewBounds(focus, 1.35, 0.18);
  return new Proj(west, east, south, north, narrow ? SEAT_NARROW_WIDTH : 680);
}

/** One drawing's settings, from its region and width. */
function mapContext(region: MapRegion, geo: Geo, narrow: boolean): MapCtx {
  const pr = mapProjection(region, geo.cities, narrow);
  return {
    region,
    geo,
    narrow,
    pr,
    inside: (lat, lon) => pr.south <= lat && lat <= pr.north && pr.west <= lon && lon <= pr.east,
    strong: (c) => (region === "all" ? c.hub : c.core),
    narrowKind: narrow ? (region === "all" ? "all" : "outpost") : false,
    regions: region === "all" ? REGION_ORDER : [region],
  };
}

/** The svg tag, its title and description, and the plain ground. */
function mapHead(m: MapCtx): string[] {
  const { region, narrow, pr } = m;
  const id = `map-${region}${narrow ? "-n" : ""}`;
  const titleName = region === "all" ? "Photon Mountain, Fusion Canyon and Space Peak" : REGION_NAMES[region];
  return [
    openSvg(`sv sv-map${region === "all" ? " sv-map--all" : ""}`, pr.W, pr.H, `${id}-t ${id}-d`, narrow),
    `<title id="${id}-t">Map of the Front Range showing ${esc(titleName)}</title>`,
    `<desc id="${id}-d">${esc(mapDesc(m))}</desc>`,
    `<rect class="sv-plain" width="${pr.W.toFixed(0)}" height="${pr.H.toFixed(0)}"/>`,
  ];
}

/** The description: each outpost's towns in view, the peaks marked, and the Slack seat's reach. */
function mapDesc({ region, geo, inside, regions }: MapCtx): string {
  const desc: string[] = [];
  for (const rid of regions) {
    const towns = geo.cities.filter((c) => c.region === rid && inside(c.lat, c.lon)).map((c) => c.name);
    if (towns.length > 0) desc.push(`${REGION_NAMES[rid]} covers ${andList(towns)}.`);
  }
  const shownPeaks = geo.peaks.filter((p) => inside(p.lat, p.lon)).map((p) => p.name);
  if (shownPeaks.length > 0) desc.push(`Peaks marked: ${andList(shownPeaks)}.`);
  if (region === "all") desc.push("The Slack seat covers all of Colorado.");
  return desc.join(" ");
}

/** Mountain ground: the ridge line to the west edge, and the ridge triangles on it. */
function mountainGround({ pr }: MapCtx): string[] {
  const pts: string[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    const lat = pr.south + ((pr.north - pr.south) * i) / steps;
    const [x, y] = pr.xy(lat, ridgeLon(lat));
    pts.push(`${f1(x)},${f1(y)}`);
  }
  pts.push("0,0.0", `0,${f1(pr.H)}`);
  return [`<polygon class="sv-land" points="${pts.join(" ")}"/>`, `<g class="sv-ridge">${mountains(pr, 7)}</g>`];
}

/** A city label's box at phone size (about 12 units a letter), so outpost names can avoid it. */
function cityLabelBox({ pr, narrowKind }: MapCtx, c: GeoCity): Box {
  const [x, y] = pr.xy(c.lat, c.lon);
  const [dx, dy, anchor] = labelOf(c.name, narrowKind);
  const span = c.name.length * 12 + 10;
  // 10 units of room past the anchor's open end; a centered label gets 5 on each side.
  const x0 = anchor === "start" ? x + dx - 10 : anchor === "middle" ? x + dx - span / 2 - 5 : leftOf(x + dx, span, anchor);
  return [x0, y + dy - 22, x0 + span + 10, y + dy + 8];
}

/** A phone outpost map's peak label: west of the marker or hanging below it (about 8 units a letter). */
function peakLabelBox(pr: Proj, p: Geo["peaks"][number]): Box {
  const [x, y] = pr.xy(p.lat, p.lon);
  const span = p.name.length * 8;
  if (narrowPeakSide(p.name, false) === "west") return [x - 13 - span, y - 10, x - 13, y + 8];
  const lx = Math.min(Math.max(x, span / 2 + 4), pr.W - span / 2 - 4);
  return [lx - span / 2, y + 10, lx + span / 2, y + 28];
}

/** City labels, town dots, peak markers and a phone outpost map's peak labels: what region names avoid. */
function obstacles(m: MapCtx): Obstacles {
  const { region, narrow, geo, pr, inside, strong } = m;
  const shownPeaks = geo.peaks.filter((p) => inside(p.lat, p.lon));
  return {
    cityBoxes: geo.cities
      .filter((c) => inside(c.lat, c.lon) && (strong(c) || (region !== "all" && c.region === region)))
      .map((c) => cityLabelBox(m, c)),
    townDots: geo.cities
      .filter((c) => inside(c.lat, c.lon) && (region === "all" || c.region === region))
      .map((c) => pr.xy(c.lat, c.lon))
      .map(([x, y]): Box => [x - 7, y - 7, x + 7, y + 7]),
    peakMarks: shownPeaks.map((p) => pr.xy(p.lat, p.lon)).map(([x, y]): Box => [x - 10, y - 10, x + 10, y + 7]),
    peakLabels: narrow && region !== "all" ? shownPeaks.map((p) => peakLabelBox(pr, p)) : [],
  };
}

/** The ellipse around an outpost's towns, grown until every town sits well inside. */
function regionEllipse(ps: readonly (readonly [number, number])[]): Ellipse {
  const xs = ps.map((p) => p[0]);
  const ys = ps.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 34;
  let ry = (Math.max(...ys) - Math.min(...ys)) / 2 + 30;
  // An ellipse drawn around a box misses the box's corners; grow it until every town sits well inside.
  const reach = Math.max(...ps.map(([px, py]) => Math.hypot((px - cx) / rx, (py - cy) / ry)));
  if (reach > 0.9) {
    rx = (rx * reach) / 0.9;
    ry = (ry * reach) / 0.9;
  }
  return { cx, cy, rx, ry };
}

/** Each outpost's highlight and name. */
function regionMarks(m: MapCtx, ob: Obstacles): string[] {
  const out: string[] = [];
  for (const rid of m.regions) {
    const ps = m.geo.cities.filter((c) => c.region === rid && m.inside(c.lat, c.lon)).map((c) => m.pr.xy(c.lat, c.lon));
    if (ps.length === 0) continue;
    const e = regionEllipse(ps);
    out.push(`<ellipse class="sv-zone" cx="${f1(e.cx)}" cy="${f1(e.cy)}" rx="${f1(e.rx)}" ry="${f1(e.ry)}"/>`);
    const name = REGION_NAMES[rid];
    out.push(m.narrow ? narrowRegionName(m, name, e, ob) : wideRegionName(m, name, e, ob.cityBoxes));
  }
  return out;
}

/** An outpost name one word a line, the first line's baseline at `first`. */
const stackedName = (words: readonly string[], x: number, first: number, anchor: string) =>
  `<text class="sv-region sv-halo" x="${f1(x)}" y="${f1(first)}" text-anchor="${anchor}">` +
  words.map((w, i) => `<tspan x="${f1(x)}" dy="${i === 0 ? "0" : "1.1"}em">${esc(w)}</tspan>`).join("") +
  "</text>";

/**
 * A phone drawing's outpost name, at the first spot that is inside the
 * drawing and clear of the city labels, the town dots, the peak markers, the
 * north arrow and the names already placed: on the statewide map a column
 * east of the area; then above the area, then below it, each also tried a
 * little to either side. One word a line everywhere: "Photon Mountain" on one
 * line is three quarters of the drawing's width. Display caps run about
 * 0.74 em a letter: 15.5 units at 21 ("Photon Mountain" measured 226 in
 * Chrome). The name's box joins cityBoxes, so the next name avoids it.
 */
function narrowRegionName({ region, pr }: MapCtx, name: string, { cx, cy, ry }: Ellipse, ob: Obstacles): string {
  const { W, H } = pr;
  const words = name.split(" ");
  const ww = Math.max(...words.map((w) => w.length)) * 15.5;
  const lh = 23; // 1.1 em at 21 units
  const compass: Box = [W - 42, 10, W - 10, 58]; // the north arrow and its N, drawn at W - 26
  const blocked = [...ob.cityBoxes, ...ob.townDots, ...ob.peakMarks, ...ob.peakLabels, compass];
  const free = (b: Box) => b[0] >= 4 && b[2] <= W - 4 && b[1] >= 4 && b[3] <= H - 4 && !blocked.some((o) => overlaps(b, o));
  const tall = (words.length - 1) * lh;
  // The east column at the area's middle, or a little above or below it, still beside the area.
  const columnAt = (first: number): Box => [W - 8 - ww, first - 20, W - 8, first + 5 + tall];
  const row = region === "all" ? [cy, cy - 45, cy + 45].find((first) => free(columnAt(first))) : undefined;
  if (row !== undefined) {
    ob.cityBoxes.push(columnAt(row));
    return stackedName(words, W - 8, row, "end");
  }
  // [x, first line's baseline]: the last line above the area, or the first below it.
  const spots = [cy - ry - 8 - tall, cy + ry + 22].flatMap((first) => [0, -40, 40, -80, 80].map((d) => [cx + d, first] as const));
  const boxAt = ([x, first]: readonly [number, number]): Box => [x - ww / 2, first - 20, x + ww / 2, first + 5 + tall];
  const [lx, first] = spots.find((spot) => free(boxAt(spot))) ?? [Math.min(Math.max(cx, ww / 2 + 6), W - ww / 2 - 6), Math.max(24, cy - ry - 8 - tall)];
  ob.cityBoxes.push(boxAt([lx, first]));
  return stackedName(words, lx, first, "middle");
}

/** A wide drawing's outpost name: the statewide map's east column when it is clear, else above the area. */
function wideRegionName({ region, pr }: MapCtx, name: string, { cx, cy, rx, ry }: Ellipse, cityBoxes: readonly Box[]): string {
  const { W } = pr;
  const textW = name.length * 18; // display caps run about 0.74 em a letter; 24 units on a phone
  const wordW = Math.max(...name.split(" ").map((w) => w.length)) * 18;
  const column: Box = [W - 10 - wordW, cy - 22, W - 10, cy + 34];
  const free = !cityBoxes.some((b) => overlaps(column, b));
  if (region === "all" && W - 10 - wordW > cx + rx + 12 && free) {
    // East column, one word a line, beside its ellipse on the open plains.
    const spans = name
      .split(" ")
      .map((w, i) => `<tspan x="${f1(W - 10)}" dy="${i === 0 ? "-0.15" : "1.1"}em">${esc(w)}</tspan>`)
      .join("");
    return `<text class="sv-region sv-halo" x="${f1(W - 10)}" y="${f1(cy)}" text-anchor="end">${spans}</text>`;
  }
  const ly = Math.max(34, cy - ry - 10); // 34 leaves room for the phone size
  const lx = Math.min(Math.max(cx, textW / 2 + 8), W - textW / 2 - 8);
  return `<text class="sv-region sv-halo" x="${f1(lx)}" y="${f1(ly)}" text-anchor="middle">${esc(name)}</text>`;
}
