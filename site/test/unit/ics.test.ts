// Step L2b: the "Add to calendar" files (src/components/events/ics.ts), one
// RFC 5545 VCALENDAR per event. The golden files in test/fixtures/ics/ were
// written by eventIcs and read by hand line by line; a change to the output
// shows up here as a diff.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type CalendarEvent, SNAPSHOT } from "../../src/components/events/events";
import { escapeText, eventIcs, eventSlug, foldLine, icsPath, utcStamp } from "../../src/components/events/ics";

const STAMP = "2026-11-02T23:50:57.641Z";
const golden = (name: string) => readFileSync(new URL(`../fixtures/ics/${name}`, import.meta.url), "utf8");

const timed: CalendarEvent = {
  id: "golden-timed@google.com#2026-11-03T16:00:00-07:00",
  title: "Let's Vibe AI Meetup at Junkyard Social in Boulder",
  start: "2026-11-03T16:00:00-07:00",
  end: "2026-11-03T18:00:00-07:00",
  allDay: false,
  location: "Junkyard Social Club, 2525 Frontier Ave Suite A, Boulder, CO 80301, USA",
  url: "https://letsvibe.org/",
  inPerson: true,
};

const allDay: CalendarEvent = {
  id: "golden-allday@google.com#2026-12-24",
  title: "Office closed; back Monday",
  start: "2026-12-24",
  end: "2026-12-26",
  allDay: true,
  location: null,
  url: null,
  inPerson: false,
};

/** The content lines, unfolded (RFC 5545 3.1: a CRLF and one space join). */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const prop = (ics: string, name: string) => unfold(ics).filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe("eventIcs golden files", () => {
  it("writes a timed event in UTC, byte for byte", () => {
    expect(eventIcs(timed, { stamp: STAMP })).toBe(golden("timed.ics"));
  });

  it("writes an all-day event as dates with the exclusive end, byte for byte", () => {
    const ics = eventIcs(allDay, { stamp: STAMP });
    expect(ics).toBe(golden("all-day.ics"));
    // The snapshot's end (Dec 26) is the last day; DTEND is the day after.
    expect(prop(ics, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261224"]);
    expect(prop(ics, "DTEND")).toEqual(["DTEND;VALUE=DATE:20261227"]);
  });

  it("holds one VEVENT with every property the brief names, inside a VERSION:2.0 VCALENDAR", () => {
    const lines = unfold(eventIcs(timed, { stamp: STAMP }));
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    for (const name of ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "LOCATION", "URL", "DESCRIPTION"]) {
      expect(lines.filter((l) => l.startsWith(`${name}:`)), name).toHaveLength(1);
    }
    expect(lines.some((l) => l.startsWith("BEGIN:VTIMEZONE"))).toBe(false);
  });

  it("credits the event's own page in the description, or the calendar page when there is none", () => {
    expect(prop(eventIcs(timed, { stamp: STAMP }), "DESCRIPTION")[0]).toContain("https://letsvibe.org/");
    expect(prop(eventIcs(allDay, { stamp: STAMP }), "URL")).toEqual(["URL:https://coloradostartups.org/event-calendar/"]);
  });

  it("leaves DTEND out when a timed event ends as it starts", () => {
    const ics = eventIcs({ ...timed, end: timed.start }, { stamp: STAMP });
    expect(prop(ics, "DTEND")).toEqual([]);
  });
});

describe("text escaping", () => {
  it("escapes backslash, semicolon, comma and newline", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
    expect(escapeText("one\r\ntwo\rthree")).toBe("one\\ntwo\\nthree");
  });

  it("keeps an injected ATTENDEE line inside SUMMARY", () => {
    const ics = eventIcs({ ...timed, title: "Demo night\nATTENDEE:mailto:x@example.com\r\nEND:VEVENT" }, { stamp: STAMP });
    const lines = unfold(ics);
    expect(lines.filter((l) => l.startsWith("ATTENDEE"))).toEqual([]);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
    expect(prop(ics, "SUMMARY")).toEqual(["SUMMARY:Demo night\\nATTENDEE:mailto:x@example.com\\nEND:VEVENT"]);
  });

  it("drops other control characters, and a URL that is not plain http(s)", () => {
    expect(escapeText("tab\there\u0007")).toBe("tabhere");
    const ics = eventIcs({ ...timed, url: "javascript:alert(1)" }, { stamp: STAMP });
    expect(prop(ics, "URL")).toEqual(["URL:https://coloradostartups.org/event-calendar/"]);
  });
});

describe("line folding", () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;

  it("folds at 75 octets with CRLF and a leading space, and unfolds to the same line", () => {
    const line = `SUMMARY:${"x".repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBe(3);
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
    expect(octets(parts[0]!)).toBe(75);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("never splits a multi-byte character", () => {
    const line = `LOCATION:${"Café Ü ".repeat(30)}`;
    const parts = foldLine(line).split("\r\n");
    for (const p of parts) {
      expect(octets(p)).toBeLessThanOrEqual(75);
      expect(p).not.toContain("�");
    }
    expect(parts.join("\r\n").replace(/\r\n /g, "")).toBe(line);
  });

  it("ends every line of a file with CRLF and no line passes 75 octets", () => {
    const ics = eventIcs({ ...timed, title: "A ".repeat(80) }, { stamp: STAMP });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const l of ics.split("\r\n")) expect(octets(l)).toBeLessThanOrEqual(75);
  });
});

describe("UIDs and file names", () => {
  it("are stable for the same event and differ between events", () => {
    expect(eventSlug(timed)).toBe("2026-11-03-ad94b87cc540");
    expect(eventSlug({ ...timed })).toBe(eventSlug(timed));
    expect(eventSlug(allDay)).not.toBe(eventSlug(timed));
    expect(prop(eventIcs(timed, { stamp: STAMP }), "UID")).toEqual(["UID:2026-11-03-ad94b87cc540@coloradostartups.org"]);
    // A new DTSTAMP or title does not move the UID.
    const later = eventIcs({ ...timed, title: "Renamed" }, { stamp: "2026-12-01T00:00:00Z" });
    expect(prop(later, "UID")).toEqual(prop(eventIcs(timed, { stamp: STAMP }), "UID"));
  });

  it("are URL-safe and never collide across the snapshot", () => {
    const events = SNAPSHOT?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    const slugs = events.map(eventSlug);
    for (const s of slugs) expect(s).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{12}$/);
    expect(new Set(slugs).size).toBe(new Set(events.map((e) => e.id)).size);
    expect(icsPath(timed)).toBe("/events/2026-11-03-ad94b87cc540.ics");
  });
});

describe("UTC conversion", () => {
  it("reads the offset on each side of the daylight-saving change", () => {
    // Denver leaves daylight time at 2 a.m. on Nov 1, 2026: 6 p.m. is 00:00Z
    // the day before and 01:00Z the day after.
    expect(utcStamp(Date.parse("2026-10-31T18:00:00-06:00"))).toBe("20261101T000000Z");
    expect(utcStamp(Date.parse("2026-11-02T18:00:00-07:00"))).toBe("20261103T010000Z");
    // March 8, 2027, daylight time again.
    expect(utcStamp(Date.parse("2027-03-08T09:00:00-06:00"))).toBe("20270308T150000Z");
    const ics = eventIcs({ ...timed, start: "2026-10-31T23:30:00-06:00", end: "2026-11-01T01:30:00-07:00" }, { stamp: STAMP });
    expect(prop(ics, "DTSTART")).toEqual(["DTSTART:20261101T053000Z"]);
    expect(prop(ics, "DTEND")).toEqual(["DTEND:20261101T083000Z"]);
  });
});
