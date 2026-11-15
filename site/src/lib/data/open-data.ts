// Pure shaping for the open-data files beside /data/resources.json:
// companies.json, events.json, guides.json and regions.json. No Astro imports:
// the endpoint files under src/pages/data/ load the collections and pass them
// in, and test/unit/mcp/open-data.test.ts runs these in plain Node. The /mcp
// Worker reads the files back (worker/mcp/data.ts).
import type { OpenCompany, OpenEvent, OpenGuide, OpenRegion, PlaceRegion, Region, ResourceCard } from "@cs/shared";

import type { CalendarEvent } from "../../components/events/events";
import type { BoardRow } from "../leaderboard/board";
import { ELSEWHERE, regionForCity } from "../regions/match";

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** One JSON response, the way resources.json.ts answers. */
export function jsonFile(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** The Leaderboard's honorees, one per company, sorted by id. */
export function openCompanies(rows: readonly BoardRow[], regions?: readonly Region[]): OpenCompany[] {
  return rows
    .map(({ company, groups }) => ({ ...company, groups, region: regionForCity(company.hq_city, regions) }))
    .sort(byId);
}

/**
 * The region of an event's location, read part by part from the end: "Junkyard
 * Social Club, 2525 Frontier Ave, Boulder, CO 80301, USA" finds Boulder. A
 * location with no listed city, or none at all, is "elsewhere".
 */
export function placeRegion(location: string | null, regions?: readonly Region[]): PlaceRegion {
  if (!location) return ELSEWHERE;
  for (const part of location.split(",").reverse()) {
    const region = regionForCity(part, regions);
    if (region !== ELSEWHERE) return region;
  }
  return ELSEWHERE;
}

/** Upcoming events as the calendar page lists them, each with its region. */
export function openEvents(events: readonly CalendarEvent[], regions?: readonly Region[]): OpenEvent[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: e.location,
    url: e.url,
    inPerson: e.inPerson,
    region: placeRegion(e.location, regions),
  }));
}

/** A guide's row: a city guide takes its city's region, a topic guide is statewide. */
export function openGuide(
  g: { slug: string; title: string; description: string; path: string; answer: string },
  city: string | undefined,
  regions?: readonly Region[],
): OpenGuide {
  return {
    id: g.slug,
    title: g.title,
    description: g.description,
    url: g.path,
    answer: g.answer,
    region: city ? regionForCity(city, regions) : ELSEWHERE,
  };
}

/** The three regions in display order, each with the resources whose city maps to it. */
export function openRegions(regions: readonly Region[], cards: readonly ResourceCard[]): OpenRegion[] {
  return regions.map((r) => ({
    id: r.id,
    name: r.name,
    summary: r.summary,
    url: `/regions/${r.id}/`,
    cities: [...r.cities],
    nearby: [...r.nearby],
    resources: cards
      .filter((c) => regionForCity(c.city, regions) === r.id)
      .map((c) => c.id)
      .sort(),
  }));
}
