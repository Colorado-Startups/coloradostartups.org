// One event as an iCalendar file (RFC 5545), for the "Add to calendar" link on
// each row of /event-calendar/'s list (EventList.astro). The files are built
// at build time by pages/events/[id].ics.ts. Owner: L2b.
//
// Titles and places come from a third-party calendar, so every text value is
// escaped (backslash, semicolon, comma, newline) and stripped of other control
// characters: a newline in a title stays inside SUMMARY and cannot start a new
// property. Times are written in UTC, so the file needs no VTIMEZONE.
import { createHash } from "node:crypto";

import type { CalendarEvent } from "./events";

export const SITE = "https://coloradostartups.org";
export const CALENDAR_PAGE = `${SITE}/event-calendar/`;
export const PRODID = "-//Colorado Startups//Event calendar//EN";

const CRLF = "\r\n";
const LINE_OCTETS = 75;
const encoder = new TextEncoder();

/**
 * A URL-safe, stable name for an event's file: its first day plus 12 hex
 * digits of a SHA-256 of the snapshot id ("2026-11-03-1a2b3c4d5e6f"). The
 * snapshot ids hold "@", "#" and ":", so they cannot be paths themselves.
 */
export function eventSlug(e: Pick<CalendarEvent, "id" | "start">): string {
  const hash = createHash("sha256").update(e.id).digest("hex").slice(0, 12);
  return `${e.start.slice(0, 10)}-${hash}`;
}

/** The site path of an event's .ics file. */
export const icsPath = (e: Pick<CalendarEvent, "id" | "start">) => `/events/${eventSlug(e)}.ics`;

/** A TEXT value (RFC 5545 3.3.11): control characters dropped, then \ ; , and newlines escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Folds one content line at 75 octets (RFC 5545 3.1): each continuation line
 * starts with a space, which counts toward its 75. A UTF-8 character is never
 * split across lines.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > LINE_OCTETS) {
      out.push(current);
      current = " ";
      octets = 1;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join(CRLF);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as a UTC DATE-TIME: 20261103T150000Z. */
export function utcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** A YYYY-MM-DD day as a DATE value, optionally moved on by some days. */
function dateValue(day: string, addDays = 0): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + addDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

/** A URI value: http(s) only, with no whitespace or control characters, else null. */
function uriValue(url: string | null): string | null {
  if (!url || !/^https?:\/\/[^\s\u0000-\u001f\u007f]+$/.test(url)) return null;
  return url;
}

export interface IcsOptions {
  /** DTSTAMP: when the snapshot was read. Fixed per build, so the file is stable. */
  stamp: string;
}

/**
 * The calendar file for one event. All-day events use DATE values with the
 * exclusive end RFC 5545 wants (the snapshot's end is the last day). A timed
 * event that ends when it starts has no DTEND.
 */
export function eventIcs(e: CalendarEvent, { stamp }: IcsOptions): string {
  const page = uriValue(e.url);
  const description = page
    ? `From the Colorado Startups event calendar (${CALENDAR_PAGE}). The host's page has the details: ${page}`
    : `From the Colorado Startups event calendar (${CALENDAR_PAGE}). Check with the host before you go.`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${eventSlug(e)}@coloradostartups.org`,
    `DTSTAMP:${utcStamp(Date.parse(stamp))}`,
  ];
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(e.start)}`, `DTEND;VALUE=DATE:${dateValue(e.end, 1)}`);
  } else {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    lines.push(`DTSTART:${utcStamp(start)}`);
    if (end > start) lines.push(`DTEND:${utcStamp(end)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  lines.push(`URL:${page ?? CALENDAR_PAGE}`, `DESCRIPTION:${escapeText(description)}`, "END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
