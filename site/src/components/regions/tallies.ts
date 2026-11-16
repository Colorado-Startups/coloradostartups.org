// Pure shaping for the /regions/ tallies (Tallies.astro, step W6). No Astro
// imports, so it unit-tests in plain Node. The counts themselves come from
// the helpers the pages already use: buildBoard and honoreesIn for the
// Leaderboard, activeCards and inRegion for Startup Resources, upcomingEvents
// for the calendar and the positions collection for seats. Owner: L8.
import { type CalendarEvent, cardPlace, startsAt } from "../events/events";

/** Days ahead the events tally counts. */
export const EVENT_WINDOW_DAYS = 30;

/** Upcoming events that start within `days` of `now`. Pass upcomingEvents() output. */
export function startingWithin(events: readonly CalendarEvent[], now: Date, days = EVENT_WINDOW_DAYS): CalendarEvent[] {
  const end = now.getTime() + days * 86_400_000;
  return events.filter((e) => startsAt(e) <= end);
}

/**
 * The city an event's location names, the last part of the card's place
 * ("ID345, Denver" reads "Denver"), or "" with no location. A location with
 * no city, such as "Online", comes back as it is and maps to no region.
 */
export function eventCity(e: Pick<CalendarEvent, "location">): string {
  if (!e.location) return "";
  const parts = cardPlace(e.location).split(",");
  return parts[parts.length - 1]!.trim();
}

/**
 * Each count as a share of the largest in its tally, 0 to 1, so a bar scales
 * within its own tally across the three regions. All zero when every count is.
 */
export function shares(counts: readonly number[]): number[] {
  const max = Math.max(0, ...counts);
  return counts.map((n) => (max === 0 ? 0 : n / max));
}
