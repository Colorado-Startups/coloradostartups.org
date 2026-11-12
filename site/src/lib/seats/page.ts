// What one seat page needs to render (lane L38), gathered once in
// pages/get-involved/[seat].astro and handed to every block.
import type { Common, Fact, Geo, Seat, SeatCourse } from "./load";
import type { Footnotes } from "./sources";

interface Keeper {
  id: "communitas";
  name: string;
  title: string;
  /** dwarves.yaml's own disclosure line: "Communitas is an AI agent run by Colorado Startups. ..." */
  disclosure: string;
}

export interface SeatContext {
  seat: Seat;
  common: Common;
  facts: Readonly<Record<string, Fact>>;
  geo: Geo;
  courses: readonly SeatCourse[];
  notes: Footnotes;
  keeper: Keeper;
  applyHref: string;
}

/** The page's <title> text before BaseLayout adds " | Colorado Startups". Names the seat and says volunteer. */
export function seatPageTitle(seat: Pick<Seat, "title">): string {
  return `${seat.title}, a volunteer seat`;
}

/** The meta description: the seat, the unpaid volunteer line's meaning, then the kit's one-liner. */
export function seatPageDescription(seat: Pick<Seat, "title" | "one_liner">): string {
  return `The ${seat.title} is an unpaid volunteer role at Colorado Startups. ${seat.one_liner}`;
}

/** The seat page's own path. */
export function seatPagePath(id: string): string {
  return `/get-involved/${id}/`;
}

/** Hours as the kit writes them: 7.25, 10. */
export function formatHours(hours: number): string {
  return String(Number(hours.toFixed(2)));
}
