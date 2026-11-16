// Each region's three counts for the home map's zones (step W2), read at build
// time: its Leaderboard companies, its events in the next 7 days and its Startup
// Resources. Nothing is counted by hand here. Each count is the site's own
// counter, called the way the page that shows it calls it:
//   companies  honoreesIn() over buildBoard(), as /regions/<id>/ tallies them
//              (RegionHonorees.astro);
//   resources  inRegion() over activeCards(), as /regions/<id>/ tallies them
//              (RegionResources.astro);
//   events     upcomingEvents() and placeRegion(), as /data/events.json gives
//              each event its region, kept to those that start in the next
//              seven days.
// Regions come back in REGIONS order, the data's fixed order: regions are
// equals, so nothing here sorts them by a count.
import type { RegionId } from "@cs/shared";
import { getCollection } from "astro:content";

import { activeCards } from "../canvas/canvas-data";
import { SNAPSHOT, startsAt, upcomingEvents } from "../events/events";
import { placeRegion } from "../../lib/data/open-data";
import { buildBoard, latestEdition } from "../../lib/leaderboard/board";
import { REGIONS } from "../../lib/regions/match";
import { honoreesIn, inRegion } from "../../lib/regions/page";

/** "Next 7 days": events that have not ended and start within seven days of the build. */
export const WEEK_MS = 7 * 86_400_000;

export interface ZoneCounts {
  id: RegionId;
  name: string;
  companies: number;
  events: number;
  resources: number;
}

/** Each count's label, in the order the map's cards and the list beside it show them. */
export const COUNT_LABELS = [
  ["companies", "Leaderboard companies"],
  ["events", "Events, next 7 days"],
  ["resources", "Startup Resources"],
] as const satisfies readonly (readonly [keyof Omit<ZoneCounts, "id" | "name">, string])[];

export async function zoneCounts(now = new Date()): Promise<ZoneCounts[]> {
  const regions = [...REGIONS];
  const cards = await activeCards();
  const companies = (await getCollection("companies")).map((e) => e.data);
  const edition = latestEdition((await getCollection("editions")).map((e) => e.data));
  const board = edition ? buildBoard(edition, companies).map((row) => row.company) : [];
  const week = upcomingEvents(SNAPSHOT, now).filter((e) => startsAt(e) < now.getTime() + WEEK_MS);
  return regions.map((r) => ({
    id: r.id,
    name: r.name,
    companies: honoreesIn(r.id, board, regions).length,
    events: week.filter((e) => placeRegion(e.location, regions) === r.id).length,
    resources: inRegion(r.id, cards, (c) => c.city, regions).length,
  }));
}
