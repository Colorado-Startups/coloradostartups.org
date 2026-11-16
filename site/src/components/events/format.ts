// Whether a listed event is in person, online, both, or has no place yet, for
// the tags and the Format chips on /event-calendar/'s list (EventList.astro).
// Owner: L2b.
//
// The snapshot's inPerson (scripts/events/lib/events.mjs isInPerson) means
// "at a street address we can name", which the JSON-LD and the region tags
// need. It is false for "Virtual and in person (check registration)" and for
// an event with no location, and L2a tagged both Online. This reads the same
// location text with the same two patterns, so:
//   - a street address, or a place that does not say virtual, is in person;
//   - a place that says virtual, online or a meeting app is online too;
//   - no location at all is "Place to be announced", neither filter.
// The data has no separate format field, so a place that names both is
// both: the reading that never hides an in-person event.
import type { CalendarEvent } from "./events";

// The same patterns as VIRTUAL and IN_PERSON in scripts/events/lib/events.mjs;
// test/unit/events-format.test.ts keeps them equal.
export const VIRTUAL = /\b(?:virtual(?:ly)?|online|zoom|webinar|livestream(?:ed)?|live\s+stream|google\s+meet|(?:ms|microsoft)\s+teams)\b/i;
export const IN_PERSON = /\bin[\s-]?person\b|\bhybrid\b/i;

export interface EventFormat {
  inPerson: boolean;
  online: boolean;
}

export function formatOf(e: Pick<CalendarEvent, "location" | "inPerson">): EventFormat {
  if (!e.location) return { inPerson: false, online: false };
  const online = VIRTUAL.test(e.location);
  return { inPerson: e.inPerson || !online || IN_PERSON.test(e.location), online };
}

/** The row's data-type: the Format chip values it matches, space-separated ("in-person online"). */
export function formatTokens(f: EventFormat): string {
  return [f.inPerson && "in-person", f.online && "online"].filter(Boolean).join(" ");
}

/** The tag a row shows for its format, or null for in person only (its region tag says where). */
export function formatLabel(f: EventFormat): string | null {
  if (f.inPerson && f.online) return "In person and online";
  if (f.online) return "Online";
  if (!f.inPerson) return "Place to be announced";
  return null;
}
