// The next-events cards on /event-calendar/: reads the snapshot that
// scripts/events/fetch-ics.mjs writes, keeps what has not ended yet, and
// formats it in Mountain Time. Also builds the page's Event JSON-LD. Owner: L24.
//
// The snapshot already passed the content gate (scripts/events/lib/lint.mjs).
// The built-HTML gate reads the visible cards again, but it never reads
// <script> text, so the JSON-LD here carries only events and fields the
// snapshot holds and the cards are built from.
import { z } from "zod";

import snapshotRaw from "../../../../data/events/upcoming.json?raw";
import { denverMidnight } from "../dispatches/feed";
import { CALENDAR_TIMEZONE } from "../info/links";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

const CalendarEventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    location: z.string().min(1).nullable(),
    url: z
      .string()
      .regex(/^https?:\/\/\S+$/)
      .nullable(),
    inPerson: z.boolean(),
  })
  .refine((e) => (e.allDay ? DATE.test(e.start) && DATE.test(e.end) : DATE_TIME.test(e.start) && DATE_TIME.test(e.end)), {
    message: "start and end are dates for all-day events and offset date-times otherwise",
  });

const SnapshotSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  timeZone: z.literal(CALENDAR_TIMEZONE),
  windowDays: z.number().int().positive(),
  events: z.array(CalendarEventSchema),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * The snapshot, or null when the file does not parse. A bad file shows the
 * empty list rather than failing the build; test/unit/l24 catches it first.
 */
export function parseSnapshot(text: string): Snapshot | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = SnapshotSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export const SNAPSHOT = parseSnapshot(snapshotRaw);
if (!SNAPSHOT) console.warn("events: data/events/upcoming.json did not parse; /event-calendar/ lists no events.");

// All-day events start and end at midnight in Denver (the snapshot's zone is
// always CALENDAR_TIMEZONE). The feed's denverMidnight reads the offset before
// the 2 a.m. switch, so both change days come out right (#179).
const midnight = (day: string) => Date.parse(denverMidnight(day));

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** When an event ends, as an instant. An all-day event ends after its last day. */
export function endsAt(e: CalendarEvent): number {
  return e.allDay ? midnight(nextDay(e.end)) : Date.parse(e.end);
}

export function startsAt(e: CalendarEvent): number {
  return e.allDay ? midnight(e.start) : Date.parse(e.start);
}

/** Events that have not ended by `now`, soonest first. */
export function upcomingEvents(snapshot: Snapshot | null, now: Date): CalendarEvent[] {
  if (!snapshot) return [];
  return snapshot.events
    .filter((e) => endsAt(e) > now.getTime())
    .sort((a, b) => startsAt(a) - startsAt(b) || a.title.localeCompare(b.title));
}

/** How many cards the page shows: the next six events (the redesign, 2026-11-15). */
export const NEXT_COUNT = 6;

// A date-only value is read at noon UTC, so its calendar day is the same in
// every US zone; times carry their own offset.
const asDate = (value: string) => new Date(DATE.test(value) ? `${value}T12:00:00Z` : value);

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: CALENDAR_TIMEZONE, hour: "numeric", minute: "2-digit" });

// ICU puts a narrow no-break space before AM and PM. A plain space reads the
// same and keeps the text searchable.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

/**
 * The day and the time, in Mountain Time:
 * { day: "Wed, Oct 21", time: "5:30 PM to 7:30 PM" }. All-day events say
 * "All day", and an event over several days names its last day.
 */
export function whenText(e: CalendarEvent): { day: string; time: string } {
  const start = asDate(e.start);
  const end = asDate(e.end);
  const day = plain(dayFormat.format(start));
  const endDay = plain(dayFormat.format(end));
  if (e.allDay) return { day, time: e.start === e.end ? "All day" : `All day, through ${endDay}` };
  const startTime = plain(timeFormat.format(start));
  const endTime = plain(timeFormat.format(end));
  if (e.start === e.end) return { day, time: startTime };
  if (endDay === day) return { day, time: `${startTime} to ${endTime}` };
  return { day, time: `${startTime} to ${endDay}, ${endTime}` };
}

/** The full location, without a trailing ", USA": the JSON-LD address. */
export function shownLocation(e: CalendarEvent): string | null {
  return e.location ? e.location.replace(/,\s*(?:USA|United States)$/i, "") : null;
}

/**
 * The date block on a card, in Mountain Time: { month: "Nov", day: "17",
 * weekday: "Tue" }. A multi-day event shows its first day.
 */
export function dateParts(e: CalendarEvent): { month: string; day: string; weekday: string } {
  const parts = dayFormat.formatToParts(asDate(e.start));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { month: part("month"), day: part("day"), weekday: part("weekday") };
}

const STATE_ZIP = /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;

/**
 * The place as a card shows it: the venue and the city, without the street
 * ("ID345, 3960 High St, Denver, CO 80205, USA" reads "ID345, Denver"). A
 * location with no state, such as "Online", shows as it is.
 */
export function cardPlace(location: string): string {
  const parts = location
    .replace(/,\s*(?:USA|United States)$/i, "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const state = parts.findIndex((p) => STATE_ZIP.test(p));
  if (state < 1) return parts.join(", ");
  const city = parts[state - 1]!;
  const venue = parts[0]!;
  return state === 1 || /^\d/.test(venue) ? city : `${venue}, ${city}`;
}

/** The venue name: the location up to its first comma, unless that is a street number. */
export function placeName(location: string): string {
  const head = location.split(",")[0].trim();
  return /^\d/.test(head) ? location : head;
}

/**
 * One JSON-LD block for the page: an Event for each in-person event with a
 * location, since Google's Event guidance leaves out online-only events and
 * needs name, startDate and location. Undefined when there are none, so the
 * page ships no empty block.
 */
export function eventsJsonLd(events: readonly CalendarEvent[]): Record<string, unknown> | undefined {
  const graph = events
    .filter((e) => e.inPerson && e.location)
    .map((e) => {
      const location = shownLocation(e)!;
      return {
        "@type": "Event",
        name: e.title,
        startDate: e.start,
        endDate: e.end,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: { "@type": "Place", name: placeName(location), address: location },
        ...(e.url ? { url: e.url } : {}),
      };
    });
  return graph.length ? { "@context": "https://schema.org", "@graph": graph } : undefined;
}
