// Pure shaping for /regions/ and /regions/<id>/. Owner: L8. No Astro imports:
// the pages load the collections and pass the data in, and
// test/unit/l8/page.test.ts covers the open and filled organizer cases and
// the six-item spread the region pages show.

import {
  type Company,
  type Person,
  type Position,
  type Region,
  type RegionId,
  type ResourceCard,
  regionLede,
} from "@cs/shared";

import { holderOf } from "../../components/positions/positions";
import { regionForCity } from "./match";

export interface Organizer {
  position: Position;
  /** The person in the seat, when it is filled. */
  holder?: Person;
}

/**
 * The organizer seat for a region, with its holder when filled. Throws when
 * positions.yaml has no seat or two seats for the region, or names a holder
 * people.yaml does not have, so the page never renders a seat that is wrong.
 */
export function organizerFor(region: RegionId, positions: readonly Position[], people: readonly Person[]): Organizer {
  const seats = positions.filter((p) => p.area === "region" && p.region === region);
  if (seats.length !== 1) {
    throw new Error(`data/team/positions.yaml needs one organizer seat for ${region}; found ${seats.length}`);
  }
  const position = seats[0]!;
  if (position.status === "open") return { position };
  const holder = holderOf(position, people);
  if (!holder) throw new Error(`position ${position.id} names holder "${position.holder}", who is not in people.yaml`);
  return { position, holder };
}

/**
 * The seat's role word, for a label beside the region's own name: "Connector"
 * from "Photon Mountain Connector" (decision 67 sets the titles). A title that
 * does not start with the region's name comes back whole, so a renamed seat
 * never shows a clipped label.
 */
export function seatRole(position: Pick<Position, "title">, regionName: string): string {
  const prefix = `${regionName} `;
  return position.title.startsWith(prefix) ? position.title.slice(prefix.length) : position.title;
}

// The house list style now lives in lib/text.ts; pages and components still import it here.
export { andList } from "../text";

/** Items whose city maps to the region, in their input order. */
export function inRegion<T>(region: RegionId, items: readonly T[], city: (item: T) => string, regions?: readonly Region[]): T[] {
  return items.filter((item) => regionForCity(city(item), regions) === region);
}

/** Honorees headquartered in the region: the board's company rows, A to Z. */
export function honoreesIn(region: RegionId, companies: readonly Company[], regions?: readonly Region[]): Company[] {
  return inRegion(region, companies, (c) => c.hq_city, regions);
}

/** A Startup Resources link that opens filtered to one city (L3 reads ?city=). */
export function canvasCityHref(city: string): string {
  return `/ecosystem-canvas/?city=${encodeURIComponent(city)}`;
}

/**
 * Up to `n` items, a spread across groups: the first item of each group in
 * turn, then the second of each, until there are `n`. Groups go in `order`
 * (any group missing from it follows, in order of first appearance); items
 * keep their input order inside a group. A region page shows six resources
 * across the founder journey this way, and six honorees across sectors.
 */
export function spread<T>(items: readonly T[], groupOf: (item: T) => string, n: number, order: readonly string[] = []): T[] {
  const groups = new Map<string, T[]>(order.map((key) => [key, []]));
  for (const item of items) {
    const key = groupOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const queues = [...groups.values()].filter((g) => g.length > 0);
  const out: T[] = [];
  for (let round = 0; out.length < n && queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round] !== undefined && out.length < n) out.push(q[round]!);
  }
  return out;
}

/** Where a founder new to a region starts: people first, then programs and places, then services. */
export const FIRST_STOPS: readonly ResourceCard["type"][] = [
  "community",
  "accelerator",
  "coworking",
  "incubator",
  "university",
  "government",
  "nonprofit",
  "event",
  "education",
  "investor",
  "service-provider",
  "media",
  "tool",
  "other",
];

/**
 * A newcomer's first `n` stops among a region's Startup Resources: one per
 * type in turn, in FIRST_STOPS order, a core city's ahead of a nearby
 * town's. The directory has no ranking, so this order is the choice. The
 * region page's resource list and its painting's hotspot card both use it.
 */
export function firstStops<T extends Pick<ResourceCard, "type" | "city">>(
  region: Pick<Region, "cities">,
  cards: readonly T[],
  n: number,
): T[] {
  const core = (c: T) => (region.cities.includes(c.city) ? 0 : 1);
  return spread(
    [...cards].sort((a, b) => core(a) - core(b)),
    (c) => c.type,
    n,
    FIRST_STOPS,
  );
}

/** The directory or the Leaderboard filtered to one region: each reads ?region=<id>. */
export function regionFilterHref(page: "/ecosystem-canvas/" | "/leaderboard/", region: RegionId): string {
  return `${page}?region=${encodeURIComponent(region)}`;
}

/** A region's summary after its lede (its first sentence), for a caption that does not repeat the lede. */
export function summaryAfterLede(region: Pick<Region, "summary">): string {
  const summary = region.summary.trim();
  return summary.slice(regionLede(region).length).trim();
}
