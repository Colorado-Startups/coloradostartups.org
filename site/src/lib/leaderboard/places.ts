// Map positions for Colorado cities that appear as a company HQ. Rounded to two
// decimals (about a kilometer): the map shows where companies cluster, not
// street addresses. Positions follow the U.S. Census Bureau Gazetteer place
// files. test/unit/l2/data.test.ts fails when a company's Colorado HQ city is
// missing here, so a new city cannot fall off the map unnoticed.
//
// hq_city convention in data/leaderboard/companies: a Colorado city is written
// as the city alone ("Boulder"); a city outside Colorado carries its state
// code ("Seattle, WA") and is listed in the table but not mapped.

export interface Place {
  lat: number;
  lon: number;
}

export const COLORADO_PLACES: Readonly<Record<string, Place>> = {
  Arvada: { lat: 39.8, lon: -105.09 },
  Aspen: { lat: 39.19, lon: -106.82 },
  Aurora: { lat: 39.73, lon: -104.83 },
  Boulder: { lat: 40.02, lon: -105.27 },
  Breckenridge: { lat: 39.48, lon: -106.04 },
  Broomfield: { lat: 39.92, lon: -105.09 },
  "Buena Vista": { lat: 38.84, lon: -106.13 },
  Carbondale: { lat: 39.4, lon: -107.21 },
  Cascade: { lat: 38.9, lon: -104.97 },
  "Castle Rock": { lat: 39.37, lon: -104.86 },
  Centennial: { lat: 39.58, lon: -104.88 },
  "Colorado Springs": { lat: 38.83, lon: -104.82 },
  "Copper Mountain": { lat: 39.5, lon: -106.15 },
  "Crested Butte": { lat: 38.87, lon: -106.99 },
  Denver: { lat: 39.74, lon: -104.99 },
  Durango: { lat: 37.28, lon: -107.88 },
  Edwards: { lat: 39.64, lon: -106.59 },
  Englewood: { lat: 39.65, lon: -104.99 },
  Erie: { lat: 40.05, lon: -105.05 },
  "Estes Park": { lat: 40.38, lon: -105.52 },
  Evergreen: { lat: 39.63, lon: -105.32 },
  "Fort Collins": { lat: 40.59, lon: -105.08 },
  Frederick: { lat: 40.1, lon: -104.94 },
  "Glenwood Springs": { lat: 39.55, lon: -107.32 },
  Golden: { lat: 39.76, lon: -105.22 },
  "Grand Junction": { lat: 39.06, lon: -108.55 },
  Greeley: { lat: 40.42, lon: -104.71 },
  "Greenwood Village": { lat: 39.62, lon: -104.95 },
  "Highlands Ranch": { lat: 39.55, lon: -104.97 },
  "La Junta": { lat: 37.99, lon: -103.54 },
  Lafayette: { lat: 39.99, lon: -105.09 },
  Lakewood: { lat: 39.7, lon: -105.08 },
  Littleton: { lat: 39.61, lon: -105.02 },
  "Lone Tree": { lat: 39.54, lon: -104.9 },
  Longmont: { lat: 40.17, lon: -105.1 },
  Louisville: { lat: 39.98, lon: -105.13 },
  Loveland: { lat: 40.4, lon: -105.08 },
  Lyons: { lat: 40.22, lon: -105.27 },
  Nederland: { lat: 39.96, lon: -105.51 },
  Niwot: { lat: 40.1, lon: -105.17 },
  "Pagosa Springs": { lat: 37.27, lon: -107.01 },
  Parker: { lat: 39.52, lon: -104.76 },
  Pueblo: { lat: 38.25, lon: -104.61 },
  Salida: { lat: 38.53, lon: -106.0 },
  Silverthorne: { lat: 39.63, lon: -106.07 },
  "Steamboat Springs": { lat: 40.49, lon: -106.83 },
  Superior: { lat: 39.95, lon: -105.17 },
  Thornton: { lat: 39.87, lon: -104.97 },
  Vail: { lat: 39.64, lon: -106.37 },
  Westminster: { lat: 39.84, lon: -105.04 },
  "Wheat Ridge": { lat: 39.77, lon: -105.08 },
  Windsor: { lat: 40.48, lon: -104.9 },
};

// Colorado's borders follow lines of latitude and longitude: 37°N to 41°N and
// 102°03'W to 109°03'W (Colorado Encyclopedia, "Colorado's Boundaries").
// The ring runs clockwise: d3-geo reads a counterclockwise ring as the whole
// globe minus the shape, which would shrink Colorado to a point on the map.
export const COLORADO_OUTLINE = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-109.05, 37],
        [-109.05, 41],
        [-102.05, 41],
        [-102.05, 37],
        [-109.05, 37],
      ],
    ],
  },
};

// True when hq_city names a Colorado city on the map (a COLORADO_PLACES key).
// A city outside Colorado ("Seattle, WA") is false.
export function isColoradoCity(hqCity: string): boolean {
  return Object.hasOwn(COLORADO_PLACES, hqCity);
}
