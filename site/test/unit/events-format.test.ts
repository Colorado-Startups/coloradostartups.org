// Step L2b: the format tags on /event-calendar/'s list (src/components/events/
// format.ts). L2a tagged an event with no location, and one both online and in
// person, as Online, so a hybrid event showed only under the Online filter.
import { describe, expect, it } from "vitest";

import { IN_PERSON as SCRIPT_IN_PERSON, isInPerson, VIRTUAL as SCRIPT_VIRTUAL } from "../../../scripts/events/lib/events.mjs";
import { SNAPSHOT, upcomingEvents } from "../../src/components/events/events";
import { formatLabel, formatOf, formatTokens, IN_PERSON, VIRTUAL } from "../../src/components/events/format";

// Each sample's inPerson is what the fetch script writes for its location.
const sample = (location: string | null) => ({ location, inPerson: isInPerson(location) });

const HYBRID = sample("Virtual and in person (check registration)");
const ONLINE = sample("Online");
const IN_PERSON_ONLY = sample("ID345, 3960 High St, Denver, CO 80205, USA");
const NO_PLACE = sample(null);

describe("formatOf", () => {
  it("reads a hybrid event as in person and online", () => {
    expect(formatOf(HYBRID)).toEqual({ inPerson: true, online: true });
    expect(formatTokens(formatOf(HYBRID))).toBe("in-person online");
    expect(formatLabel(formatOf(HYBRID))).toBe("In person and online");
  });

  it("reads an online-only event as online", () => {
    expect(formatOf(ONLINE)).toEqual({ inPerson: false, online: true });
    expect(formatTokens(formatOf(ONLINE))).toBe("online");
    expect(formatLabel(formatOf(ONLINE))).toBe("Online");
    expect(formatOf(sample("Zoom (link after you register)")).online).toBe(true);
  });

  it("reads a street address as in person, with no extra tag", () => {
    expect(formatOf(IN_PERSON_ONLY)).toEqual({ inPerson: true, online: false });
    expect(formatTokens(formatOf(IN_PERSON_ONLY))).toBe("in-person");
    expect(formatLabel(formatOf(IN_PERSON_ONLY))).toBeNull();
  });

  it("reads a named place with no address as in person, so it is never hidden from that filter", () => {
    expect(formatOf(sample("Galvanize Boulder"))).toEqual({ inPerson: true, online: false });
  });

  it("reads no location as place to be announced, under neither format", () => {
    expect(formatOf(NO_PLACE)).toEqual({ inPerson: false, online: false });
    expect(formatTokens(formatOf(NO_PLACE))).toBe("");
    expect(formatLabel(formatOf(NO_PLACE))).toBe("Place to be announced");
  });

  it("uses the fetch script's own patterns", () => {
    expect(VIRTUAL.source).toBe(SCRIPT_VIRTUAL.source);
    expect(VIRTUAL.flags).toBe(SCRIPT_VIRTUAL.flags);
    expect(IN_PERSON.source).toBe(SCRIPT_IN_PERSON.source);
    expect(IN_PERSON.flags).toBe(SCRIPT_IN_PERSON.flags);
  });

  it("keeps the list's order within one day: start time, then title", () => {
    const base = { allDay: false, location: null, url: null, inPerson: false };
    const ev = (id: string, title: string, start: string, end: string) => ({ ...base, id, title, start, end });
    const snapshot = {
      source: "",
      fetchedAt: "2026-11-02T00:00:00Z",
      timeZone: "America/Denver" as const,
      windowDays: 60,
      events: [
        ev("c", "Zeta pitch night", "2026-11-20T18:00:00-07:00", "2026-11-20T20:00:00-07:00"),
        ev("b", "Beta meetup", "2026-11-20T16:00:00-07:00", "2026-11-20T18:00:00-07:00"),
        ev("a", "Alpha meetup", "2026-11-20T16:00:00-07:00", "2026-11-20T17:00:00-07:00"),
        ev("d", "Early coffee", "2026-11-20T07:30:00-07:00", "2026-11-20T08:30:00-07:00"),
      ],
    };
    const titles = upcomingEvents(snapshot, new Date("2026-11-19T00:00:00Z")).map((e) => e.title);
    expect(titles).toEqual(["Early coffee", "Alpha meetup", "Beta meetup", "Zeta pitch night"]);
  });

  it("never drops an event the snapshot calls in person from the In person filter", () => {
    for (const e of SNAPSHOT?.events ?? []) {
      if (e.inPerson) expect(formatOf(e).inPerson, e.title).toBe(true);
      if (!e.location) expect(formatTokens(formatOf(e)), e.title).toBe("");
    }
  });
});
