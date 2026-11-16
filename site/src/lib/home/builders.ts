// The home page's Builders band (step P1): 12 companies from the latest
// Leaderboard edition. No Astro imports, so test/dom/home/builders.test.ts
// runs it in plain Node.
//
// | Step | Rule |
// | --- | --- |
// | 1 | Four groups: the three regions in their data order (regions are equals), then the honorees outside them |
// | 2 | Each group's honorees spread across its cities: the largest city first, ties A to Z, companies A to Z inside a city |
// | 3 | The week turns each group's list on by its share of the 12, then the groups are taken in turn |
// | 4 | The 12 shown are listed A to Z: no positions, no "top" |
//
// Rotation: the week is the ISO week (Monday 00:00 UTC) of `date`, the build
// time unless a test passes one, so every build in a week shows the same 12.
// The site has no scheduled build: the set turns at the first deploy after a
// Monday, and every honoree gets a turn within a few such weeks.
import type { Company, Region } from "@cs/shared";

import { countBy } from "../leaderboard/board";
import { isSector, type Sector } from "../leaderboard/sectors";
import {
  ELSEWHERE,
  regionForCity,
  type RegionOrElsewhere,
} from "../regions/match";
import { spread } from "../regions/page";

export const BUILDERS_COUNT = 12;

export interface Builder {
  id: string;
  name: string;
  region: RegionOrElsewhere;
  /** One word for the company's sector, the tile's only line under its name. */
  sector: string;
}

/** One word for each Leaderboard sector, so 12 tiles fit the band's 60 words. */
export const SECTOR_WORD: Readonly<Record<Sector, string>> = {
  "AI and data": "Data",
  Software: "Software",
  Cybersecurity: "Cybersecurity",
  "Cloud and infrastructure": "Cloud",
  "Space and aerospace": "Space",
  "Defense and public safety": "Defense",
  "Energy and climate": "Energy",
  "Materials and manufacturing": "Manufacturing",
  "Hardware and robotics": "Hardware",
  "Quantum and photonics": "Quantum",
  "Health care": "Health",
  "Life sciences": "Biotech",
  "Fintech and insurance": "Fintech",
  Education: "Education",
  "Consumer and retail": "Consumer",
  "Food and beverage": "Food",
  "Travel, hospitality and events": "Travel",
  "Real estate and construction": "Property",
  "Media and entertainment": "Media",
  "Logistics and mobility": "Logistics",
  "Nonprofit and community": "Nonprofit",
};

/** The sector's one word; an unknown sector (the data test forbids one) keeps its first word. */
export function sectorWord(sector: string): string {
  return isSector(sector)
    ? SECTOR_WORD[sector]
    : (sector.split(/[\s,]+/)[0] ?? sector);
}

const DAY = 86_400_000;
/** Weeks since the ISO week that holds 1970-01-01; it changes each Monday at 00:00 UTC. */
export function weekIndex(date: Date): number {
  // 1970-01-01 was a Thursday; its ISO week began on Monday 1969-12-29, three days earlier.
  return Math.floor((Math.floor(date.getTime() / DAY) + 3) / 7);
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** One group's companies spread across their cities, largest city first. */
function acrossCities(companies: readonly Company[]): Company[] {
  const sorted = [...companies].sort(byName);
  const cityOrder = countBy(sorted, (c) => c.hq_city).map((c) => c.key);
  return spread(sorted, (c) => c.hq_city, sorted.length, cityOrder);
}

const turn = <T>(list: readonly T[], by: number): T[] => {
  if (list.length === 0) return [];
  const k = ((by % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
};

export function pickBuilders(
  companies: readonly Company[],
  regions: readonly Region[],
  date: Date = new Date(),
  n = BUILDERS_COUNT,
): Builder[] {
  const regionOf = (c: Company) => regionForCity(c.hq_city, regions);
  const order: RegionOrElsewhere[] = [...regions.map((r) => r.id), ELSEWHERE];
  const groups = order
    .map((id) => acrossCities(companies.filter((c) => regionOf(c) === id)))
    .filter((g) => g.length > 0);
  const share = Math.ceil(n / Math.max(groups.length, 1));
  const week = weekIndex(date);
  const picked = spread(
    groups.flatMap((g) => turn(g, week * share)),
    regionOf,
    n,
    order,
  );
  return picked
    .map((c) => ({
      id: c.id,
      name: c.name,
      region: regionOf(c),
      sector: sectorWord(c.sector),
    }))
    .sort(byName);
}
