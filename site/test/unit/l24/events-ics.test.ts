// The calendar feed reader: unfolding, properties, time zones, recurrence,
// overrides, and the in-person and link rules. All offline, on inline feeds.
import { describe, expect, it } from "vitest";

import { cleanText, cleanUrl, isInPerson, pickUrl, readFeed } from "../../../../scripts/events/lib/events.mjs";
import {
  expandRrule,
  IcsError,
  nthWeekday,
  parseCalendar,
  parseDuration,
  parseLine,
  parseRrule,
  unescapeText,
  unfold,
  zonedToUtc,
} from "../../../../scripts/events/lib/ics.mjs";

const TZ = "America/Denver";
const DAY = 86_400_000;

/** A feed from VEVENT bodies, with CRLF line ends like Google's. */
const feed = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-TIMEZONE:America/Denver", ...events.map((e) => `BEGIN:VEVENT\n${e.trim()}\nEND:VEVENT`), "END:VCALENDAR"]
    .join("\n")
    .replace(/\n/g, "\r\n");

const window = (from: string, days = 60) => {
  const fromMs = Date.parse(from);
  return { fromMs, toMs: fromMs + days * DAY, timeZone: TZ };
};

const starts = (text: string, from = "2026-10-18T18:00:00Z", days = 60) => {
  const { occurrences, sources, notes } = readFeed(text, window(from, days));
  return { list: occurrences.map((o: { start: string; sourceIndex: number }) => `${o.start} ${sources[o.sourceIndex].title}`), notes };
};

describe("lines and text", () => {
  it("unfolds a folded line and drops exactly one leading space", () => {
    expect(unfold("DESCRIPTION:Small Busines\r\n s Technology\r\n  Transfer")).toBe("DESCRIPTION:Small Business Technology Transfer");
  });

  it("reads parameters, including a quoted one with a colon", () => {
    expect(parseLine('DTSTART;TZID="America/Denver":20261021T180000')).toEqual({
      name: "DTSTART",
      params: { TZID: "America/Denver" },
      value: "20261021T180000",
    });
    expect(parseLine('ATTENDEE;CN="Doe: Jane";ROLE=CHAIR:mailto:x@example.org')?.params.CN).toBe("Doe: Jane");
    expect(parseLine("not a property")).toBeNull();
  });

  it("undoes TEXT escapes", () => {
    expect(unescapeText("ID345\\, 3960 High St\\; Denver\\nCO \\\\ ok")).toBe("ID345, 3960 High St; Denver\nCO \\ ok");
  });

  it("keeps an event's own DESCRIPTION when a VALARM inside it has one", () => {
    const cal = parseCalendar(
      feed("UID:a\nDTSTART:20261021T000000Z\nDESCRIPTION:the event\nBEGIN:VALARM\nDESCRIPTION:reminder\nEND:VALARM\nSUMMARY:A"),
    );
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0].DESCRIPTION.map((p: { value: string }) => p.value)).toEqual(["the event"]);
  });

  it("refuses text that is not a calendar", () => {
    expect(() => parseCalendar("<!doctype html><title>Sign in</title>")).toThrow(IcsError);
  });

  it("reads durations", () => {
    expect(parseDuration("PT1H30M")).toBe(90 * 60_000);
    expect(parseDuration("P1D")).toBe(DAY);
    expect(parseDuration("P1W")).toBe(7 * DAY);
    expect(parseDuration("PT")).toBeNull();
  });
});

describe("time zones", () => {
  it("turns Denver wall time into the right instant on both sides of the November change", () => {
    expect(new Date(zonedToUtc(Date.UTC(2026, 9, 21, 18), TZ)).toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(new Date(zonedToUtc(Date.UTC(2026, 10, 4, 18), TZ)).toISOString()).toBe("2026-11-05T01:00:00.000Z");
  });
});

describe("recurrence rules", () => {
  it("finds the nth and the last weekday of a month", () => {
    expect(nthWeekday(2026, 10, 4, 2)).toBe(12); // second Thursday of Nov 2026
    expect(nthWeekday(2026, 9, 4, -1)).toBe(29); // last Thursday of Oct 2026
    expect(nthWeekday(2026, 1, 1, 5)).toBeNull(); // no fifth Monday in Feb 2026
  });

  it("flags rule parts it cannot expand", () => {
    expect(parseRrule("FREQ=MONTHLY;BYDAY=2TH").unsupported).toEqual([]);
    expect(parseRrule("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=-1").unsupported).toContain("BYSETPOS");
    expect(parseRrule("FREQ=HOURLY").unsupported).toContain("FREQ=HOURLY");
    expect(parseRrule("FREQ=WEEKLY;BYDAY=2TU").unsupported).toContain("BYDAY with an ordinal");
  });

  const expand = (rule: string, start: Date, horizon: Date, untilUtc?: number) =>
    expandRrule(parseRrule(rule), {
      startCivil: start.getTime(),
      horizonCivil: horizon.getTime(),
      untilUtc,
      toUtc: (c: number) => zonedToUtc(c, TZ),
    }).map((c: number) => new Date(c).toISOString().slice(0, 16));

  it("expands every other Wednesday with WKST", () => {
    expect(expand("FREQ=WEEKLY;WKST=MO;INTERVAL=2;BYDAY=WE", new Date("2026-10-07T17:00Z"), new Date("2026-11-30T00:00Z"))).toEqual([
      "2026-10-07T17:00",
      "2026-10-21T17:00",
      "2026-11-04T17:00",
      "2026-11-18T17:00",
    ]);
  });

  it("expands the second Thursday and the last Thursday of each month", () => {
    expect(expand("FREQ=MONTHLY;BYDAY=2TH", new Date("2026-10-08T18:00Z"), new Date("2026-12-31T00:00Z"))).toEqual([
      "2026-10-08T18:00",
      "2026-11-12T18:00",
      "2026-12-10T18:00",
    ]);
    expect(expand("FREQ=MONTHLY;BYDAY=-1TH", new Date("2026-10-29T16:00Z"), new Date("2027-01-01T00:00Z"))).toEqual([
      "2026-10-29T16:00",
      "2026-11-26T16:00",
      "2026-12-31T16:00",
    ]);
  });

  it("stops at COUNT and at UNTIL", () => {
    expect(expand("FREQ=DAILY;COUNT=3", new Date("2026-10-20T12:00Z"), new Date("2027-01-01T00:00Z"))).toHaveLength(3);
    const until = Date.parse("2026-11-11T06:59:59Z"); // Google's UNTIL: end of Nov 10 in Denver
    expect(expand("FREQ=MONTHLY;BYDAY=2WE", new Date("2026-10-14T17:30Z"), new Date("2027-01-01T00:00Z"), until)).toEqual([
      "2026-10-14T17:30",
    ]);
  });
});

describe("occurrences in the window", () => {
  it("keeps a weekly 6 PM meetup at 6 PM across the daylight saving change", () => {
    const { list } = starts(
      feed("UID:w\nDTSTART;TZID=America/Denver:20261021T180000\nDTEND;TZID=America/Denver:20261021T200000\nRRULE:FREQ=WEEKLY\nSUMMARY:Weekly"),
      "2026-10-18T18:00:00Z",
      21,
    );
    expect(list).toEqual(["2026-10-21T18:00:00-06:00 Weekly", "2026-10-28T18:00:00-06:00 Weekly", "2026-11-04T18:00:00-07:00 Weekly"]);
  });

  it("drops EXDATEs, swaps in a moved instance and drops a cancelled one", () => {
    const { list } = starts(
      feed(
        "UID:s\nDTSTART;TZID=America/Denver:20261021T180000\nDTEND;TZID=America/Denver:20261021T190000\nRRULE:FREQ=WEEKLY;COUNT=4\nEXDATE;TZID=America/Denver:20261028T180000\nSUMMARY:Series",
        "UID:s\nRECURRENCE-ID;TZID=America/Denver:20261104T180000\nDTSTART;TZID=America/Denver:20261105T120000\nDTEND;TZID=America/Denver:20261105T130000\nSUMMARY:Series (moved)",
        "UID:s\nRECURRENCE-ID;TZID=America/Denver:20261111T180000\nDTSTART;TZID=America/Denver:20261111T180000\nSTATUS:CANCELLED\nSUMMARY:Series",
      ),
    );
    expect(list).toEqual(["2026-10-21T18:00:00-06:00 Series", "2026-11-05T12:00:00-07:00 Series (moved)"]);
  });

  it("leaves out cancelled and private events and ones that already ended", () => {
    const { list } = starts(
      feed(
        "UID:c\nDTSTART:20261025T010000Z\nSTATUS:CANCELLED\nSUMMARY:Cancelled",
        "UID:p\nDTSTART:20261025T010000Z\nCLASS:PRIVATE\nSUMMARY:Private",
        "UID:o\nDTSTART:20261001T010000Z\nDTEND:20261001T020000Z\nSUMMARY:Over",
        "UID:k\nDTSTART:20261025T010000Z\nDTEND:20261025T020000Z\nSUMMARY:Kept",
      ),
    );
    expect(list).toEqual(["2026-10-24T19:00:00-06:00 Kept"]);
  });

  it("writes an all-day event's end as its last day, and keeps one that is under way", () => {
    const { occurrences } = readFeed(
      feed("UID:a\nDTSTART;VALUE=DATE:20261018\nDTEND;VALUE=DATE:20261021\nSUMMARY:Startup Week"),
      window("2026-10-19T18:00:00Z"),
    );
    expect(occurrences.map((o: { start: string; end: string; allDay: boolean }) => [o.start, o.end, o.allDay])).toEqual([
      ["2026-10-18", "2026-10-20", true],
    ]);
  });

  it("reads an unknown TZID as Denver time and says so", () => {
    const { list, notes } = starts(feed("UID:u\nDTSTART;TZID=Mountain Standard Time:20261021T180000\nSUMMARY:Odd zone"));
    expect(list).toEqual(["2026-10-21T18:00:00-06:00 Odd zone"]);
    expect(notes[0].reason).toMatch(/unknown TZID Mountain Standard Time/);
  });

  it("leaves a series it cannot expand to the embed, with a note", () => {
    const { list, notes } = starts(feed("UID:x\nDTSTART:20261021T000000Z\nRRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=-1\nSUMMARY:Last Tuesday"));
    expect(list).toEqual([]);
    expect(notes[0].reason).toMatch(/BYSETPOS/);
  });
});

describe("display text, places and links", () => {
  it("turns em dashes and spaced en dashes into commas", () => {
    expect(cleanText("  Startup Week — Opening   Night ")).toBe("Startup Week, Opening Night");
    expect(cleanText("Denver – Boulder")).toBe("Denver, Boulder");
    expect(cleanText("2025–2026 season")).toBe("2025–2026 season");
  });

  it("calls an event in person only at an address we can name", () => {
    expect(isInPerson("ID345, 3960 High St, Denver, CO 80205, USA")).toBe(true);
    expect(isInPerson("University of Denver, Denver, CO")).toBe(true);
    expect(isInPerson("Hybrid: Galvanize, 1062 Delaware St, Denver, CO 80204")).toBe(true);
    expect(isInPerson("Virtual event")).toBe(false);
    expect(isInPerson("Zoom, Denver, CO")).toBe(false);
    expect(isInPerson("Virtual and in person (check registration)")).toBe(false);
    expect(isInPerson("https://www.thunderviewceodinners.com")).toBe(false);
    expect(isInPerson("Galvanize")).toBe(false);
    expect(isInPerson(null)).toBe(false);
  });

  it("unwraps Google's redirect and refuses other schemes", () => {
    expect(cleanUrl("https://www.google.com/url?q=https://lu.ma/abc&amp;sa=D")).toBe("https://lu.ma/abc");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("https://user:pw@example.org/")).toBeNull();
    expect(cleanUrl("www.example.org/event).")).toBe("https://www.example.org/event");
  });

  it("prefers the URL property, then an event platform, then any page that is not a join link or a map", () => {
    expect(pickUrl({ urlProp: "https://example.org/e", description: "https://lu.ma/x", location: null })).toBe("https://example.org/e");
    const description = 'Join on <a href="https://meet.google.com/abc">Meet</a>. Map: https://maps.app.goo.gl/q. Host: https://host.example.org/about. RSVP https://lu.ma/x.';
    expect(pickUrl({ urlProp: null, description, location: null })).toBe("https://lu.ma/x");
    expect(pickUrl({ urlProp: null, description: description.replace(" RSVP https://lu.ma/x.", ""), location: null })).toBe(
      "https://host.example.org/about",
    );
    expect(pickUrl({ urlProp: null, description: "", location: "https://www.thunderviewceodinners.com" })).toBe(
      "https://www.thunderviewceodinners.com/",
    );
    expect(pickUrl({ urlProp: null, description: "Zoom: https://us02web.zoom.us/j/1", location: "Online" })).toBeNull();
  });
});
