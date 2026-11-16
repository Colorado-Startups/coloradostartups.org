import type { OpenCompany, OpenEvent } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { placeRegion } from "../../../src/lib/data/open-data";
import type { OpenData } from "../../../worker/mcp/data";
import { events, MAX_RESULTS, region, search, thisWeek, words } from "../../../worker/mcp/tools";

const ORIGIN = "https://coloradostartups.org";

const company = (id: string, name: string, region: OpenCompany["region"]): OpenCompany => ({
  id,
  name,
  website: `https://${id}.example`,
  hq_city: "Boulder",
  sector: "Space",
  description: "Builds satellites.",
  sources: [`https://${id}.example`],
  groups: ["Overall"],
  region,
});

const event = (id: string, start: string, end: string, region: OpenEvent["region"]): OpenEvent => ({
  id,
  title: `Meetup ${id}`,
  start,
  end,
  allDay: false,
  location: null,
  url: null,
  inPerson: true,
  region,
});

const DATA: OpenData = {
  resources: [],
  companies: Array.from({ length: 30 }, (_, i) => company(`co-${i}`, `Orbit ${i}`, i % 2 ? "space-peak" : "photon-mountain")),
  events: [
    event("a", "2026-11-10T18:00:00-07:00", "2026-11-10T20:00:00-07:00", "photon-mountain"),
    event("b", "2026-11-16T18:00:00-07:00", "2026-11-16T20:00:00-07:00", "space-peak"),
    event("c", "2026-11-20T18:00:00-07:00", "2026-11-20T20:00:00-07:00", "photon-mountain"),
  ],
  guides: [
    {
      id: "funding-programs",
      title: "Funding programs for Colorado startups",
      description: "Angel groups and investors.",
      url: "/guides/funding-programs/",
      answer: "Startup Resources lists angel groups.",
      region: "elsewhere",
    },
  ],
  regions: [
    {
      id: "space-peak",
      name: "Space Peak",
      summary: "Colorado Springs.",
      url: "/regions/space-peak/",
      cities: ["Colorado Springs"],
      nearby: [],
      resources: [],
    },
  ],
};

describe("search", () => {
  it("caps results at 25", () => {
    expect(search(DATA, { words: "orbit" }, ORIGIN)).toHaveLength(MAX_RESULTS);
  });

  it("filters by type and region", () => {
    const hits = search(DATA, { words: "orbit", type: "company", region: "space-peak" }, ORIGIN);
    expect(hits.length).toBe(15);
    expect(hits.every((h) => h.region === "space-peak")).toBe(true);
    expect(search(DATA, { words: "orbit", type: "guide" }, ORIGIN)).toEqual([]);
  });

  it("finds a guide by a word in its answer, with an absolute link", () => {
    const [hit] = search(DATA, { words: "angel" }, ORIGIN);
    expect(hit).toMatchObject({ type: "guide", url: `${ORIGIN}/guides/funding-programs/` });
  });

  it("returns nothing for a query with no words", () => {
    expect(words("? !")).toEqual([]);
    expect(search(DATA, { words: "?" }, ORIGIN)).toEqual([]);
  });
});

describe("events", () => {
  const now = new Date("2026-11-15T17:00:00Z");

  it("starts today in Denver by default", () => {
    expect(events(DATA, {}, now).map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("keeps the days between from and to, in one region", () => {
    expect(events(DATA, { from: "2026-11-01", to: "2026-11-16" }, now).map((e) => e.id)).toEqual(["a", "b"]);
    expect(events(DATA, { from: "2026-11-01", region: "photon-mountain" }, now).map((e) => e.id)).toEqual(["a", "c"]);
  });
});

describe("region", () => {
  it("counts a region's companies and upcoming events and caps each list", () => {
    const r = region(DATA, "space-peak", ORIGIN, new Date("2026-11-15T17:00:00Z"))!;
    expect(r.counts).toEqual({ resources: 0, companies: 15, upcomingEvents: 1 });
    expect(r.companies).toHaveLength(10);
    expect(r.url).toBe(`${ORIGIN}/regions/space-peak/`);
  });

  it("answers null for a region with no data", () => {
    expect(region(DATA, "fusion-canyon", ORIGIN, new Date())).toBeNull();
  });
});

describe("placeRegion", () => {
  it("reads the city out of a street address", () => {
    expect(placeRegion("Junkyard Social Club, 2525 Frontier Ave Suite A, Boulder, CO 80301, USA")).toBe("photon-mountain");
    expect(placeRegion("Exponential Impact, 2 N Cascade Ave, Colorado Springs, CO 80903")).toBe("space-peak");
  });

  it("leaves an online or missing location elsewhere", () => {
    expect(placeRegion("Virtual and in person (check registration)")).toBe("elsewhere");
    expect(placeRegion(null)).toBe("elsewhere");
  });
});

describe("thisWeek", () => {
  // One event a day at noon Denver time, plus one all-day event, around both
  // 2026 clock changes: spring forward on 2026-03-08, fall back on 2026-11-01.
  const day = (d: string, offset: string) => event(`d-${d}`, `${d}T12:00:00${offset}`, `${d}T13:00:00${offset}`, "photon-mountain");
  const WEEK: OpenData = {
    ...DATA,
    events: [
      day("2026-03-07", "-07:00"),
      day("2026-03-08", "-06:00"),
      day("2026-03-14", "-06:00"),
      day("2026-03-15", "-06:00"),
      day("2026-10-31", "-06:00"),
      day("2026-11-01", "-07:00"),
      day("2026-11-07", "-07:00"),
      { ...event("d-2026-11-08", "2026-11-08", "2026-11-08", "photon-mountain"), allDay: true },
    ],
  };
  const ids = (now: string) => thisWeek(WEEK, {}, ORIGIN, new Date(now)).events.map((e) => e.id);
  const window = (now: string) => {
    const w = thisWeek(WEEK, {}, ORIGIN, new Date(now));
    return [w.from, w.to];
  };

  it("starts on 2026-03-08 just before spring forward (01:59 MST)", () => {
    expect(window("2026-03-08T08:59:00Z")).toEqual(["2026-03-08", "2026-03-14"]);
    expect(ids("2026-03-08T08:59:00Z")).toEqual(["d-2026-03-08", "d-2026-03-14"]);
  });

  it("starts on 2026-03-08 just after spring forward (03:01 MDT)", () => {
    expect(window("2026-03-08T09:01:00Z")).toEqual(["2026-03-08", "2026-03-14"]);
    expect(ids("2026-03-08T09:01:00Z")).toEqual(["d-2026-03-08", "d-2026-03-14"]);
  });

  it("is still 2026-03-07 at 23:59 MST the night before", () => {
    expect(window("2026-03-08T06:59:00Z")).toEqual(["2026-03-07", "2026-03-13"]);
    expect(ids("2026-03-08T06:59:00Z")).toEqual(["d-2026-03-07", "d-2026-03-08"]);
  });

  it("starts on 2026-11-01 just before and just after fall back", () => {
    // 01:59 MDT, then 01:01 MST: the same Denver day either side.
    for (const now of ["2026-11-01T07:59:00Z", "2026-11-01T08:01:00Z"]) {
      expect(window(now)).toEqual(["2026-11-01", "2026-11-07"]);
      expect(ids(now)).toEqual(["d-2026-11-01", "d-2026-11-07"]);
    }
  });

  it("is still 2026-11-01 at 23:30 MST, after the hour fall back adds", () => {
    expect(window("2026-11-02T06:30:00Z")).toEqual(["2026-11-01", "2026-11-07"]);
  });

  it("leaves out an event on day 8", () => {
    expect(ids("2026-11-01T18:00:00Z")).not.toContain("d-2026-11-08");
    expect(ids("2026-03-08T18:00:00Z")).not.toContain("d-2026-03-15");
  });

  it("keeps at most 10 events, soonest first, and counts the rest", () => {
    const many: OpenData = {
      ...DATA,
      events: Array.from({ length: 12 }, (_, i) => event(`m${String(11 - i).padStart(2, "0")}`, `2026-11-1${i % 6}T0${i % 10}:00:00-07:00`, `2026-11-1${i % 6}T23:00:00-07:00`, "space-peak")),
    };
    const w = thisWeek(many, {}, ORIGIN, new Date("2026-11-10T15:00:00Z"));
    expect(w.events).toHaveLength(10);
    expect(w.moreEvents).toBe(2);
    const starts = w.events.map((e) => e.start);
    expect(starts).toEqual([...starts].sort());
  });
});
