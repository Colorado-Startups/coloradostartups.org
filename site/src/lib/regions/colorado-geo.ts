// The statewide map's data: the Colorado outline and the three zones, from
// data/geo/ (built by scripts/geo/build.mjs from US Census places). Data only,
// so the browser bundle (components/map/colorado-map.client.ts) can import it
// without Plot or JSDOM.
import type { RegionId } from "@cs/shared";

// The same raw-import pattern as lib/seats/load.ts.
const files = import.meta.glob<string>("../../../../data/geo/*.geojson", { query: "?raw", import: "default", eager: true });
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
  properties: { id: RegionId; name: string; cities: string[]; towns: string[]; cityPoints: CityPoint[]; method: string; note: string };
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

/** [[west, south], [east, north]] of the state outline. */
export const COLORADO_BOUNDS: [LonLat, LonLat] = (() => {
  const ring = COLORADO.features[0]!.geometry.coordinates[0]!;
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
})();

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
