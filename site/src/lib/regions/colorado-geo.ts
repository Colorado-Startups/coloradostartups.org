// The statewide map's data: the Colorado outline and the three zones, from
// data/geo/ (built by scripts/geo/build.mjs from US Census road lines and
// places). Each zone is the loop its named roads close. Data only, so the
// browser bundle (components/map/colorado-map.client.ts) can import it without
// Plot or JSDOM.
import type { RegionId } from "@cs/shared";

// The same raw-import pattern as lib/seats/load.ts. Only these two files: the
// traced roads and the yardstick in data/geo/ stay out of the browser bundle.
const files = import.meta.glob<string>("../../../../data/geo/{colorado,regions}.geojson", { query: "?raw", import: "default", eager: true });
function raw(name: string): string {
  const text = files[`../../../../data/geo/${name}.geojson`];
  if (!text) throw new Error(`data/geo/${name}.geojson is missing; run node scripts/geo/build.mjs`);
  return text;
}

export type LonLat = [number, number];

export interface CityPoint {
  name: string;
  lon: number;
  lat: number;
}

interface Polygon {
  type: "Polygon";
  coordinates: LonLat[][];
}

export interface ZoneFeature {
  type: "Feature";
  id: RegionId;
  properties: {
    id: RegionId;
    name: string;
    /** The cities on the loop's corners, and their centres. */
    cities: string[];
    cityPoints: CityPoint[];
    /** The nearby towns, most of them outside the line, and their points. */
    towns: string[];
    townPoints: CityPoint[];
    /** The named roads the loop follows, in order. */
    roads: string[];
    area_sq_mi: number;
    span_mi: number;
    /** The loop's area as a multiple of Silicon Valley's US-101 and I-280 loop. */
    vs_silicon_valley: number;
    method: string;
    note: string;
  };
  geometry: Polygon;
}

export interface FeatureCollection<F> {
  type: "FeatureCollection";
  source: string;
  license: string;
  features: F[];
}

export interface OutlineFeature {
  type: "Feature";
  id: "colorado";
  properties: { name: string };
  geometry: Polygon;
}

export const COLORADO = JSON.parse(raw("colorado")) as FeatureCollection<OutlineFeature>;
export const ZONES = JSON.parse(raw("regions")) as FeatureCollection<ZoneFeature>;

/** A dimmed zone's fill and line opacity, in a map zoomed to another zone: the drawing and the live map share it. */
export const DIM = { fill: 0.05, line: 0.35 } as const;

/** [[west, south], [east, north]] of a ring. */
function ringBounds(ring: readonly LonLat[]): [LonLat, LonLat] {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** [[west, south], [east, north]] of the state outline. */
export const COLORADO_BOUNDS: [LonLat, LonLat] = ringBounds(COLORADO.features[0]!.geometry.coordinates[0]!);

/** One zone by id; throws when data/geo/regions.geojson lacks it, so a page never draws an empty map. */
export function zoneById(id: RegionId): ZoneFeature {
  const zone = ZONES.features.find((z) => z.id === id);
  if (!zone) throw new Error(`data/geo/regions.geojson has no zone "${id}"; run node scripts/geo/build.mjs`);
  return zone;
}

/**
 * [[west, south], [east, north]] of one zone, for a map zoomed to it: its loop
 * and its cities, since a corner city can sit just outside the line.
 */
export function zoneBounds(id: RegionId): [LonLat, LonLat] {
  const zone = zoneById(id);
  return ringBounds([...zone.geometry.coordinates[0]!, ...zone.properties.cityPoints.map((c): LonLat => [c.lon, c.lat])]);
}

/**
 * Where a zone's name sits: 0.12° off the zone at its middle latitude. East, on
 * the open plains, by default; west, over the mountains, on a narrow map, where
 * the plains run out before the name does.
 */
export function zoneLabelPoint(zone: ZoneFeature, side: "east" | "west" = "east"): LonLat {
  const ring = zone.geometry.coordinates[0]!;
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const lon = side === "east" ? Math.max(...lons) + 0.12 : Math.min(...lons) - 0.12;
  return [lon, (Math.min(...lats) + Math.max(...lats)) / 2];
}
