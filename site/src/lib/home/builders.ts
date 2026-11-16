// The home page's Builders band (step P1): 12 companies from the latest
// Leaderboard edition, picked the same way on every build. No Astro imports,
// so test/dom/home/builders.test.ts runs it in plain Node.
//
// | Step | Rule |
// | --- | --- |
// | 1 | Each region's honorees, spread across its cities: the largest city first, ties A to Z, companies A to Z inside a city |
// | 2 | Those lists spread across the regions, in the regions' data order (regions are equals) |
// | 3 | Only if the regions run short, companies outside them fill the rest, the same way |
//
// Each card's line is the first sentence of the company's public description.
import type { Company, Region, RegionId } from "@cs/shared";

import { countBy } from "../leaderboard/board";
import { ELSEWHERE, regionForCity, type RegionOrElsewhere } from "../regions/match";
import { spread } from "../regions/page";

export const BUILDERS_COUNT = 12;

export interface Builder {
  id: string;
  name: string;
  city: string;
  region: RegionOrElsewhere;
  line: string;
}

/** The first sentence of a description: up to the first ". " or the end. */
export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^.+?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
}

const byName = (a: Company, b: Company) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** One group's companies spread across their cities, largest city first. */
function acrossCities(companies: readonly Company[]): Company[] {
  const sorted = [...companies].sort(byName);
  const cityOrder = countBy(sorted, (c) => c.hq_city).map((c) => c.key);
  return spread(sorted, (c) => c.hq_city, sorted.length, cityOrder);
}

export function pickBuilders(companies: readonly Company[], regions: readonly Region[], n = BUILDERS_COUNT): Builder[] {
  const listed = [...companies];
  const regionOf = (c: Company) => regionForCity(c.hq_city, regions);
  const ids: RegionId[] = regions.map((r) => r.id);
  const perRegion = ids.flatMap((id) => acrossCities(listed.filter((c) => regionOf(c) === id)));
  const picked = spread(perRegion, regionOf, n, ids);
  if (picked.length < n) picked.push(...acrossCities(listed.filter((c) => regionOf(c) === ELSEWHERE)).slice(0, n - picked.length));
  return picked.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.hq_city,
    region: regionOf(c),
    line: firstSentence(c.description),
  }));
}
