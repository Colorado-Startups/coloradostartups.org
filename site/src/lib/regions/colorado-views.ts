// What the build-time drawing needs beyond the zones (colorado-geo.ts): each
// map view's frame, the highways inside it, each loop's traced roads and the
// Silicon Valley yardstick. Built by scripts/geo/views.mjs and build.mjs.
// Server only: no browser bundle imports this, so the road lines never ship
// as JavaScript.
import type { RegionId } from "@cs/shared";

import type { LonLat } from "./colorado-geo";

const files = import.meta.glob<string>("../../../../data/geo/{views.json,highways.geojson,roads.geojson,silicon-valley.geojson}", {
  query: "?raw",
  import: "default",
  eager: true,
});
function parsed<T>(name: string): T {
  const text = files[`../../../../data/geo/${name}`];
  if (!text) throw new Error(`data/geo/${name} is missing; run node scripts/geo/build.mjs --roads, then node scripts/geo/views.mjs`);
  return JSON.parse(text) as T;
}

/** A view's frame: its four edges in degrees, and its size in px. Web Mercator, as the live map is. */
export interface Frame {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
}

export type ViewId = "state" | `zone-${RegionId}` | `thumb-${RegionId}`;
export const VIEWS = parsed<Record<ViewId, Frame>>("views.json");

export interface Highway {
  /** The statewide view, or the region whose zoomed map and thumbnail draw it. */
  view: "state" | RegionId;
  /** As a road sign reads: "I-25", "US-287", "CO-14". */
  name: string;
  kind: "interstate" | "us" | "state";
  lines: LonLat[][];
}
export const HIGHWAYS: Highway[] = parsed<{ features: { properties: Omit<Highway, "lines">; geometry: { coordinates: LonLat[][] } }[] }>(
  "highways.geojson",
).features.map((f) => ({ ...f.properties, lines: f.geometry.coordinates }));

export interface LoopRoad {
  /** A region id, or "silicon-valley". */
  loop: string;
  /** The name the map shows, such as "US-36". */
  road: string;
  line: LonLat[];
}
export const LOOP_ROADS: LoopRoad[] = parsed<{ features: { properties: { loop: string; road: string }; geometry: { coordinates: LonLat[] } }[] }>(
  "roads.geojson",
).features.map((f) => ({ loop: f.properties.loop, road: f.properties.road, line: f.geometry.coordinates }));

export interface Yardstick {
  name: string;
  roads: string[];
  area_sq_mi: number;
  span_mi: number;
  ring: LonLat[];
}
const yard = parsed<{ features: { properties: Omit<Yardstick, "ring">; geometry: { coordinates: LonLat[][] } }[] }>("silicon-valley.geojson").features[0]!;
/** Silicon Valley's US-101 and I-280 loop: the yardstick for a region's size. */
export const YARDSTICK: Yardstick = { ...yard.properties, ring: yard.geometry.coordinates[0]! };

// Web Mercator's north-south axis, in the same degrees as longitude.
const mercY = (lat: number) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Where a lon/lat point falls in a frame, as [x, y] fractions from its top-left corner. */
export function inFrame(frame: Frame, [lon, lat]: LonLat): [number, number] {
  const [top, bottom] = [mercY(frame.north), mercY(frame.south)];
  return [(lon - frame.west) / (frame.east - frame.west), (top - mercY(lat)) / (top - bottom)];
}

/** Miles across a frame, measured along its middle latitude. */
export function frameMiles(frame: Frame): number {
  const lat = (frame.north + frame.south) / 2;
  return (frame.east - frame.west) * 69.172 * Math.cos((lat * Math.PI) / 180);
}
