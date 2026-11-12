// Which region a city belongs to (decision 45). The one place that answers it:
// lib/regions/page.ts (the region pages' resource and honoree lists) and
// lib/guides/guides.ts (the city guides) call regionForCity(). Owner: L8. No
// Astro imports, so it unit-tests in plain Node (test/unit/l8/match.test.ts).
//
// The regions are read straight from data/regions/*.yaml at build time, the way
// lib/leaderboard/notes.ts reads its YAML, and validated with RegionSchema.
// City names follow the spelling in resource.city and company.hq_city.

import { REGION_IDS, RegionSchema, type Region, type RegionId } from "@cs/shared";
import { parse } from "yaml";

export const ELSEWHERE = "elsewhere";
export type RegionOrElsewhere = RegionId | typeof ELSEWHERE;

// resource.city also holds these two values. They are not places, so they never
// reach the fallback below: a statewide program belongs to no single region.
export const NOT_CITIES: ReadonlySet<string> = new Set(["statewide", "online"]);

/** The comparison key for a city: case, spacing and a trailing ", CO" ignored. */
export function cityKey(city: string): string {
  return city
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,\s*(?:co|colorado)$/i, "")
    .toLowerCase();
}

/**
 * Validates region YAML documents and returns them in display order. Throws
 * when a region is missing or repeated, or when one city is listed by two
 * regions, so an ambiguous map fails the build instead of picking a winner.
 */
export function parseRegions(documents: readonly unknown[]): Region[] {
  const regions = documents.map((doc) => RegionSchema.parse(doc));
  const ids = regions.map((r) => r.id).sort();
  if (ids.join() !== [...REGION_IDS].sort().join()) {
    throw new Error(`data/regions/ needs exactly one file per region (${REGION_IDS.join(", ")}); found ${ids.join(", ")}`);
  }
  const owner = new Map<string, RegionId>();
  for (const r of regions) {
    for (const city of [...r.cities, ...r.nearby]) {
      const key = cityKey(city);
      const other = owner.get(key);
      if (other) throw new Error(`"${city}" is listed by both ${other} and ${r.id} in data/regions/`);
      owner.set(key, r.id);
    }
  }
  return regions.sort((a, b) => a.order - b.order);
}

const files = import.meta.glob<string>("../../../../data/regions/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The three regions from data/regions/, in `order`. */
export const REGIONS: readonly Region[] = parseRegions(Object.values(files).map((text) => parse(text)));

const indexes = new WeakMap<readonly Region[], Map<string, RegionId>>();
function indexOf(regions: readonly Region[]): Map<string, RegionId> {
  let index = indexes.get(regions);
  if (!index) {
    index = new Map();
    for (const r of regions) for (const city of [...r.cities, ...r.nearby]) index.set(cityKey(city), r.id);
    indexes.set(regions, index);
  }
  return index;
}

/**
 * The region a city belongs to, from each region's `cities` and `nearby`
 * lists, or "elsewhere". Unlisted cities go to fallbackRegion().
 */
export function regionForCity(city: string, regions: readonly Region[] = REGIONS): RegionOrElsewhere {
  const key = cityKey(city);
  if (key === "" || NOT_CITIES.has(key)) return ELSEWHERE;
  return indexOf(regions).get(key) ?? fallbackRegion(city, regions);
}

/**
 * Where a Colorado city that no region lists goes. Today that is every city
 * outside the three lists: Durango, Grand Junction, Pueblo, Frederick and so on.
 *
 * Input: the city as written in the data, and the regions. Output: a region id,
 * or "elsewhere" for "Elsewhere in Colorado".
 *
 * The choices this function makes:
 *   - Keep it literal. Only listed cities belong to a region, and adding a city
 *     to a YAML list is the way in (the default).
 *   - Nearest region. Look the city up in COLORADO_PLACES
 *     (lib/leaderboard/places.ts) and pick the region whose core city is
 *     closest, within a distance you choose. Frederick would join Photon
 *     Mountain; Durango would stay elsewhere.
 *   - Out of state. A city written with its state ("Seattle, WA") is not in
 *     Colorado at all; it should stay "elsewhere" under any rule.
 *
 * test/unit/l8/match.test.ts pins the default for unlisted cities. Update those
 * cases when you change the rule.
 */
function fallbackRegion(city: string, regions: readonly Region[]): RegionOrElsewhere {
  // Paul's rule, on the Project 2 card "fallbackRegion: Paul's rule for cities
  // no region lists": replace this default in 5 to 10 lines. The default sends
  // every unlisted city to "elsewhere".
  void city;
  void regions;
  return ELSEWHERE;
}
