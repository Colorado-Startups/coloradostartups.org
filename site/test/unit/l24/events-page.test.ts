// The page side of the events list: the committed snapshot parses, the list
// keeps what has not ended, dates read in Mountain Time, and the JSON-LD
// names only in-person events with a place.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  byMonth,
  type CalendarEvent,
  endsAt,
  eventsJsonLd,
  parseSnapshot,
  placeName,
  shownLocation,
  SNAPSHOT,
  type Snapshot,
  startsAt,
  upcomingEvents,
  whenText,
} from "../../../src/components/events/events";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "x",
  title: "Founder Coffee",
  start: "2026-10-21T18:00:00-06:00",
  end: "2026-10-21T20:00:00-06:00",
  allDay: false,
  location: "ID345, 3960 High St, Denver, CO 80205, USA",
  url: "https://lu.ma/x",
  inPerson: true,
  ...over,
});

const snapshot = (events: CalendarEvent[]): Snapshot => ({
  source: "test",
  fetchedAt: "2026-10-18T18:00:00.000Z",
  timeZone: "America/Denver",
  windowDays: 60,
  events,
});

describe("the committed snapshot", () => {
  it("parses, so the page lists it", () => {
    const text = readFileSync(path.join(ROOT, "data/events/upcoming.json"), "utf8");
    expect(parseSnapshot(text)).not.toBeNull();
    expect(SNAPSHOT).not.toBeNull();
  });

  it("reads a bad file as no snapshot instead of failing the build", () => {
    expect(parseSnapshot("{")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...snapshot([]), timeZone: "UTC" }))).toBeNull();
    expect(parseSnapshot(JSON.stringify(snapshot([event({ url: "javascript:alert(1)" })])))).toBeNull();
    expect(parseSnapshot(JSON.stringify(snapshot([event({ start: "2026-10-21" })])))).toBeNull();
    expect(upcomingEvents(null, new Date())).toEqual([]);
  });
});

describe("upcomingEvents", () => {
  const list = [
    event({ id: "later", title: "B", start: "2026-10-22T09:00:00-06:00", end: "2026-10-22T10:00:00-06:00" }),
    event({ id: "over", start: "2026-10-18T08:00:00-06:00", end: "2026-10-18T09:00:00-06:00" }),
    event({ id: "now", title: "A", start: "2026-10-18T11:00:00-06:00", end: "2026-10-18T13:00:00-06:00" }),
    event({ id: "week", allDay: true, start: "2026-10-16", end: "2026-10-18" }),
    event({ id: "past-week", allDay: true, start: "2026-10-10", end: "2026-10-17" }),
  ];

  it("keeps what has not ended, soonest first, including an all-day event on its last day", () => {
    const now = new Date("2026-10-18T18:30:00Z"); // 12:30 PM in Denver
    expect(upcomingEvents(snapshot(list), now).map((e) => e.id)).toEqual(["week", "now", "later"]);
  });

  it("lets an all-day event end at midnight in Denver, not in UTC", () => {
    const lateEvening = new Date("2026-10-19T05:30:00Z"); // 11:30 PM Oct 18 in Denver
    expect(upcomingEvents(snapshot(list), lateEvening).map((e) => e.id)).toContain("week");
    const nextMorning = new Date("2026-10-19T06:30:00Z"); // 12:30 AM Oct 19 in Denver
    expect(upcomingEvents(snapshot(list), nextMorning).map((e) => e.id)).not.toContain("week");
  });

  // Midnight comes before the 2 a.m. switch, so it keeps the old day's offset (#179).
  it("starts an all-day event at midnight MST on the March change day", () => {
    const day = event({ id: "spring", allDay: true, start: "2026-03-08", end: "2026-03-08" });
    expect(startsAt(day)).toBe(Date.parse("2026-03-08T00:00:00-07:00"));
    const lateNight = event({ id: "late", start: "2026-03-07T23:30:00-07:00", end: "2026-03-07T23:45:00-07:00" });
    const now = new Date("2026-03-07T12:00:00Z");
    expect(upcomingEvents(snapshot([day, lateNight]), now).map((e) => e.id)).toEqual(["late", "spring"]);
  });

  it("ends an all-day event at midnight MDT on the November change day", () => {
    const halloween = event({ id: "halloween", allDay: true, start: "2026-10-31", end: "2026-10-31" });
    expect(endsAt(halloween)).toBe(Date.parse("2026-11-01T00:00:00-06:00"));
    const justAfter = new Date("2026-11-01T06:30:00Z"); // 12:30 AM MDT Nov 1 in Denver
    expect(upcomingEvents(snapshot([halloween]), justAfter)).toEqual([]);
  });
});

describe("whenText", () => {
  it("formats a same-day event in Mountain Time", () => {
    expect(whenText(event({}))).toEqual({ day: "Wed, Oct 21", time: "6:00 PM to 8:00 PM" });
  });

  it("formats after the November change, from a UTC time", () => {
    expect(whenText(event({ start: "2026-11-05T01:00:00+00:00", end: "2026-11-05T03:00:00+00:00" }))).toEqual({
      day: "Wed, Nov 4",
      time: "6:00 PM to 8:00 PM",
    });
  });

  it("names the last day of events that run over several days", () => {
    expect(whenText(event({ start: "2026-12-11T20:00:00-07:00", end: "2026-12-12T02:00:00-07:00" }))).toEqual({
      day: "Fri, Dec 11",
      time: "8:00 PM to Sat, Dec 12, 2:00 AM",
    });
    expect(whenText(event({ allDay: true, start: "2027-05-10", end: "2027-05-14" }))).toEqual({
      day: "Mon, May 10",
      time: "All day, through Fri, May 14",
    });
    expect(whenText(event({ allDay: true, start: "2027-05-10", end: "2027-05-10" }))).toEqual({ day: "Mon, May 10", time: "All day" });
  });

  it("shows a start time alone when the event has no end", () => {
    expect(whenText(event({ end: "2026-10-21T18:00:00-06:00" })).time).toBe("6:00 PM");
  });
});

describe("months, places and JSON-LD", () => {
  it("groups by the month in Denver, not in UTC", () => {
    const late = event({ id: "halloween", start: "2026-10-31T22:00:00-06:00", end: "2026-10-31T23:00:00-06:00" });
    const nov = event({ id: "nov", start: "2026-11-02T09:00:00-07:00", end: "2026-11-02T10:00:00-07:00" });
    expect(byMonth([late, nov]).map((m) => [m.key, m.label, m.events.map((e) => e.id)])).toEqual([
      ["2026-10", "October 2026", ["halloween"]],
      ["2026-11", "November 2026", ["nov"]],
    ]);
  });

  it("drops a trailing country and names the venue", () => {
    expect(shownLocation(event({}))).toBe("ID345, 3960 High St, Denver, CO 80205");
    expect(placeName("ID345, 3960 High St, Denver, CO 80205")).toBe("ID345");
    expect(placeName("1515 Walnut St #200, Boulder, CO 80302")).toBe("1515 Walnut St #200, Boulder, CO 80302");
  });

  it("describes only in-person events with a place, in one block", () => {
    const online = event({ id: "online", title: "Webinar", location: "Virtual event", inPerson: false, url: null });
    const ld = eventsJsonLd([event({}), online]) as { "@context": string; "@graph": Record<string, unknown>[] };
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@graph"]).toEqual([
      {
        "@type": "Event",
        name: "Founder Coffee",
        startDate: "2026-10-21T18:00:00-06:00",
        endDate: "2026-10-21T20:00:00-06:00",
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: { "@type": "Place", name: "ID345", address: "ID345, 3960 High St, Denver, CO 80205" },
        url: "https://lu.ma/x",
      },
    ]);
    expect(eventsJsonLd([online])).toBeUndefined();
    expect(eventsJsonLd([])).toBeUndefined();
  });
});
