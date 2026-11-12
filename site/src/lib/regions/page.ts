// Pure shaping for /regions/ and /regions/<id>/. Owner: L8. No Astro imports:
// the pages load the collections and pass the data in, and
// test/unit/l8/page.test.ts covers the open and filled organizer cases.

import type { Company, Person, Position, Region, RegionId } from "@cs/shared";

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
