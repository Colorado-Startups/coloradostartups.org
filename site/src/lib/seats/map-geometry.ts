// The Front Range map's geometry (front-range.ts): region names, where each
// city's label sits, the ridge line, the projection, the view box and the
// mountain triangles. Numbers only; front-range.ts draws with them.

import type { RegionId } from "@cs/shared";

import { REGIONS } from "../regions/match";
import type { Geo, GeoCity } from "./load";
import { f1 } from "./svg";

export type MapRegion = RegionId | "all";

// One drawing's settings, shared by every layer.
export interface MapCtx {
  region: MapRegion;
  geo: Geo;
  narrow: boolean;
  pr: Proj;
  inside: (lat: number, lon: number) => boolean;
  // An outpost's map draws every core city strong. The statewide map is
  // smaller, so it draws and labels only the hubs, or the north crowds (#180).
  strong: (c: GeoCity) => boolean;
  narrowKind: NarrowKind;
  regions: readonly RegionId[];
}

// Region names from data/regions/. The drawing order below is the kit's, not
// REGIONS' `order`: the statewide map and its description list them so.
export const REGION_NAMES = Object.fromEntries(REGIONS.map((r) => [r.id, r.name])) as Readonly<Record<RegionId, string>>;
export const REGION_ORDER = ["photon-mountain", "fusion-canyon", "space-peak"] as const satisfies readonly RegionId[];

// Label placement per city: dx, dy, text-anchor. Keeps the dense
// Denver-Boulder-Golden cluster readable.
type Anchor = "start" | "end" | "middle";
const LABEL: Readonly<Record<string, readonly [number, number, Anchor]>> = {
  Boulder: [-10, -8, "end"],
  Golden: [-10, 15, "end"],
  Denver: [11, 16, "start"],
  Arvada: [9, -8, "start"],
  Longmont: [9, -6, "start"],
  "Castle Rock": [9, 5, "start"],
  "Fort Collins": [11, -7, "start"],
  Loveland: [-10, 5, "end"],
  Windsor: [9, -7, "start"],
  Greeley: [9, 13, "start"],
  "Colorado Springs": [11, 5, "start"],
  Monument: [9, -6, "start"],
  Fountain: [9, 12, "start"],
  "Woodland Park": [-10, -6, "end"],
  // Above right, so the Pikes Peak marker west of it stays clear.
  "Manitou Springs": [9, -9, "start"],
  Cascade: [-10, 4, "end"],
};
// The phone drawing's overrides, where its larger relative labels would run
// off an edge or into a neighbor (#329).
const NARROW_LABEL: Readonly<Record<string, readonly [number, number, Anchor]>> = {
  "Castle Rock": [-9, 5, "end"],
  Greeley: [0, 22, "middle"],
  "Colorado Springs": [0, 24, "middle"],
  Monument: [-9, -6, "end"],
  Fountain: [-9, 12, "end"],
};
// The statewide phone map leans east instead, so its few labels mostly keep
// their wide-drawing sides.
const NARROW_LABEL_ALL: Readonly<Record<string, readonly [number, number, Anchor]>> = {
  // Below its dot, so the column east of Photon Mountain is free for the name.
  Denver: [0, 24, "middle"],
};
// Which drawing a label is for: the wide one, an outpost's phone map or the statewide phone map.
type NarrowKind = "outpost" | "all" | false;
// A city's label offset and anchor for that drawing.
export const labelOf = (name: string, narrow: NarrowKind = false) =>
  (narrow === "outpost" ? NARROW_LABEL[name] : narrow === "all" ? NARROW_LABEL_ALL[name] : undefined) ??
  LABEL[name] ??
  ([9, 4, "start"] as const);
// Where a peak's label sits on an outpost's phone drawing: Pikes Peak shares
// Colorado Springs' latitude, so its label goes west. Otherwise it hangs
// below the marker, as in the wide drawing.
export type PeakSide = "west" | "north" | "south";
// The side for a peak on an outpost's phone drawing.
export const narrowPeakSide = (name: string, _all: boolean): PeakSide => (name === "Pikes Peak" ? "west" : "south");
/** A label's left edge for its anchor and estimated width. */
export const leftOf = (x: number, span: number, anchor: Anchor) => (anchor === "end" ? x - span : anchor === "middle" ? x - span / 2 : x);

// The longitude of the foot of the mountains by latitude, for drawing the
// ridge band only. Rough by design; nothing is measured from it.
const RIDGE: readonly (readonly [number, number])[] = [
  [37.0, -104.95],
  [38.7, -104.92],
  [39.0, -104.96],
  [39.3, -105.12],
  [39.6, -105.24],
  [40.0, -105.29],
  [40.3, -105.21],
  [40.6, -105.17],
  [41.0, -105.2],
];

/** The ridge line's longitude at a latitude, interpolated between RIDGE points and held flat past either end. */
export function ridgeLon(lat: number): number {
  for (let i = 0; i < RIDGE.length - 1; i += 1) {
    const [la0, lo0] = RIDGE[i]!;
    const [la1, lo1] = RIDGE[i + 1]!;
    if (la0 <= lat && lat <= la1) return lo0 + ((lat - la0) / (la1 - la0)) * (lo1 - lo0);
  }
  return lat < RIDGE[0]![0] ? RIDGE[0]![1] : RIDGE[RIDGE.length - 1]![1];
}

/** Equirectangular projection scaled by the cosine of the middle latitude; fine at this scale. */
export class Proj {
  readonly W: number;
  readonly H: number;
  constructor(
    readonly west: number,
    readonly east: number,
    readonly south: number,
    readonly north: number,
    width: number,
  ) {
    const kx = Math.cos(((south + north) / 2) * (Math.PI / 180));
    this.W = width;
    this.H = (width * (north - south)) / ((east - west) * kx);
  }
  xy(lat: number, lon: number): [number, number] {
    return [((lon - this.west) / (this.east - this.west)) * this.W, ((this.north - lat) / (this.north - this.south)) * this.H];
  }
}

/** The [west, east, south, north] box around some points, at a width-over-height aspect, leaning west so the mountains show. */
export function viewBounds(
  points: readonly (readonly [number, number])[],
  aspect: number,
  padLat = 0.2,
  minLatSpan = 0.7,
  lean = 0.25,
): [number, number, number, number] {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  let south = Math.min(...lats) - padLat;
  let north = Math.max(...lats) + padLat;
  if (north - south < minLatSpan) {
    const mid = (north + south) / 2;
    south = mid - minLatSpan / 2;
    north = mid + minLatSpan / 2;
  }
  const kx = Math.cos(((south + north) / 2) * (Math.PI / 180));
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2 - lean; // lean west so the mountains show
  const need = Math.max(...lons) - Math.min(...lons) + 0.6;
  const lonSpan = Math.max(((north - south) * aspect) / kx, need);
  return [midLon - lonSpan / 2, midLon + lonSpan / 2, south, north];
}

/** A point NARROW_NORTH degrees north of the northernmost point, to make room above it. */
export const northOf = (points: readonly (readonly [number, number])[]) =>
  [Math.max(...points.map((p) => p[0])) + NARROW_NORTH, points[0]![1]] as const;

// A phone drawing's view, width over height: near square for an outpost and
// portrait for the statewide map, so labels have room above and below.
export const NARROW_ASPECT = { outpost: 1.0, all: 0.55 } as const;
// Less lean west than the wide drawing (0.25 degrees for an outpost, 0.12
// statewide), so the towns' labels have room east of them; the statewide map
// leans east. NARROW_NORTH adds room above the northern towns for a name.
export const NARROW_LEAN = { outpost: 0.1, all: -0.15 } as const;
const NARROW_NORTH = 0.18;

/** The kit's linear congruential step, in 32-bit integer math so it matches Python's big integers. */
const nextRand = (r: number) => (Math.imul(r, 1103515245) + 12345) & 0x7fffffff;

/** Deterministic ridge triangles west of the ridge line. */
export function mountains(pr: Proj, seed: number): string {
  const out: string[] = [];
  let rnd = seed;
  const step = 36;
  const rows = Math.trunc(pr.H / step) + 2;
  const cols = Math.trunc(pr.W / step) + 2;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      rnd = nextRand(rnd);
      const jx = (rnd % 1000) / 1000 - 0.5;
      rnd = nextRand(rnd);
      const jy = (rnd % 1000) / 1000 - 0.5;
      const x = c * step + (r % 2 ? step / 2 : 0) + jx * 10;
      const y = r * step + jy * 8;
      const lat = pr.north - (y / pr.H) * (pr.north - pr.south);
      const lon = pr.west + (x / pr.W) * (pr.east - pr.west);
      if (lon > ridgeLon(lat) - 0.04) continue;
      const h = 10 + (rnd % 9);
      const w = h * 1.35;
      out.push(`<path d="M${f1(x - w / 2)} ${f1(y + h / 2)}L${f1(x)} ${f1(y - h / 2)}L${f1(x + w / 2)} ${f1(y + h / 2)}Z"/>`);
    }
  }
  return out.join("");
}
