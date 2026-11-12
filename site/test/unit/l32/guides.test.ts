// L32: the city guides and the events guide in lib/guides/guides.ts, on small
// fixtures and on the real data/resources/ and data/regions/. The built pages
// are checked in test/dom/l32/. The L23 suite also runs every guide slug,
// these included, through its shared checks.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ResourceSchema, type Region } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type { CalendarEvent, Snapshot } from "../../../src/components/events/events";
import {
  asOf,
  buildGuide,
  byCity,
  CITY_GUIDES,
  CITY_NEEDS,
  CITY_SLUGS,
  EVENT_CALENDAR,
  GUIDE_GROUPS,
  GUIDE_SLUGS,
  guideItems,
  guideJsonLd,
  GUIDES,
  otherGuides,
  plainText,
  UPCOMING_LIMIT,
  upcomingList,
  type CitySlug,
  type Guide,
  type GuideInput,
  type GuideRecord,
  type Part,
} from "../../../src/lib/guides/guides";
import { cityKey, ELSEWHERE, REGIONS, regionForCity } from "../../../src/lib/regions/match";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/resources");
const SITE = new URL("https://coloradostartups.org");
const DATE = asOf(new Date("2026-10-18T18:00:00Z"));

const records: GuideRecord[] = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => path.join(DATA, d.name, f)))
  .map((file) => ResourceSchema.parse(parse(readFileSync(file, "utf8"))))
  .filter((r) => r.status === "active")
  .map(({ id, name, url, stage, substage, city, type, description, tags }) => ({
    id,
    name,
    url,
    stage,
    substage,
    city,
    type,
    description,
    tags,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
const real: GuideInput = { records, regions: REGIONS, date: DATE };

const rec = (over: Partial<GuideRecord> & Pick<GuideRecord, "id">): GuideRecord => ({
  name: over.id,
  url: `https://example.org/${over.id}`,
  stage: "launch",
  substage: "develop",
  city: "Denver",
  type: "accelerator",
  description: "A fixture.",
  tags: [],
  ...over,
});

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== "");
const ids = (items: readonly GuideRecord[]) => items.map((r) => r.id);
const sectionIds = (guide: Guide, id: string) => ids(guideItems({ sections: guide.sections.filter((s) => s.id === id) }));
const links = (parts: readonly Part[]) =>
  parts.filter((p): p is { text: string; href: string } => typeof p !== "string" && "href" in p);
const dates = (parts: readonly Part[]) =>
  parts.filter((p): p is { text: string; datetime: string } => typeof p !== "string" && "datetime" in p);

/**
 * The sentences of some text that state a number without a source and a date.
 * A figure counts as sourced when its sentence names Startup Resources or the
 * event calendar and says "as of" one of the given dates. Date labels and
 * "Series C" style names are not figures.
 */
function unsourcedCounts(text: string, dateLabels: readonly string[]): string[] {
  return sentences(text).filter((s) => {
    const bare = dateLabels.reduce((t, d) => t.replaceAll(d, ""), s);
    if (!/\d/.test(bare)) return false;
    const source = /Startup Resources|event calendar/.test(s);
    const dated = dateLabels.some((d) => s.includes(`as of ${d}`));
    return !(source && dated);
  });
}

/** Records that show more than once on a page, or more than once in one section. */
function duplicates(guide: Pick<Guide, "sections">): string[] {
  const seen = new Set<string>();
  return guideItems(guide)
    .map((r) => r.id)
    .filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
}

describe("self-tests for the checks below", () => {
  it("unsourcedCounts flags a bare count, a count without a date, and one without a source", () => {
    const d = [DATE.label];
    expect(unsourcedCounts("Denver has 12 accelerators.", d)).toHaveLength(1);
    expect(unsourcedCounts("Startup Resources lists 12 accelerators in Denver.", d)).toHaveLength(1);
    expect(unsourcedCounts(`We count 12 accelerators, as of ${DATE.label}.`, d)).toHaveLength(1);
    expect(unsourcedCounts(`Startup Resources lists 12 accelerators in Denver, as of ${DATE.label}.`, d)).toEqual([]);
    expect(unsourcedCounts(`Denver is in Photon Mountain. It was dated ${DATE.label}.`, d)).toEqual([]);
  });

  it("duplicates finds a record listed twice, and passes a clean page", () => {
    const a = rec({ id: "a" });
    const b = rec({ id: "b" });
    const section = (id: string, items: GuideRecord[]) => ({ id, heading: id, intro: [], groups: [{ items }] });
    expect(duplicates({ sections: [section("one", [a, b]), section("two", [a])] })).toEqual(["a"]);
    expect(duplicates({ sections: [section("one", [a, a])] })).toEqual(["a"]);
    expect(duplicates({ sections: [section("one", [a]), section("two", [b])] })).toEqual([]);
  });
});

describe("the guide registry", () => {
  it("files every guide in exactly one group", () => {
    const grouped = GUIDE_GROUPS.flatMap((g) => g.slugs);
    expect([...grouped].sort()).toEqual([...GUIDE_SLUGS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("gives each guide the other guides, grouped, without itself", () => {
    for (const slug of GUIDE_SLUGS) {
      const others = otherGuides(slug).flatMap((g) => g.guides.map((m) => m.slug));
      expect(others, slug).not.toContain(slug);
      expect(others.length, slug).toBe(GUIDE_SLUGS.length - 1);
      for (const group of otherGuides(slug)) expect(group.guides.length, group.heading).toBeGreaterThan(0);
    }
  });

  it("names each city guide for its city, in the title", () => {
    for (const slug of CITY_SLUGS) expect(GUIDES[slug].title).toBe(`Startup resources in ${CITY_GUIDES[slug]}`);
  });
});

// A small Colorado: Denver and Boulder share a region with Golden; Colorado
// Springs is alone in its region with Monument nearby.
const FIXTURE: GuideRecord[] = [
  rec({ id: "den-accel", type: "accelerator" }),
  rec({ id: "den-incub", type: "incubator" }),
  rec({ id: "den-meetup", type: "community" }),
  rec({ id: "den-pitch", type: "event", tags: ["pitch", "events"] }),
  rec({ id: "den-angels", type: "event", tags: ["investors", "networking"] }),
  rec({ id: "den-seed", type: "investor", stage: "launch", substage: "investors" }),
  rec({ id: "den-growth", type: "investor", stage: "growth", substage: "investors" }),
  rec({ id: "den-chamber", type: "government", stage: "support", substage: "organizations" }),
  rec({ id: "den-class", type: "education", stage: "idea", substage: "educate", tags: ["entrepreneurship"] }),
  rec({ id: "den-bootcamp", type: "education", stage: "idea", substage: "educate", tags: ["coding"] }),
  rec({ id: "den-uni", type: "university", stage: "support", substage: "organizations" }),
  rec({ id: "den-lawyer", type: "service-provider", stage: "launch", substage: "service-providers", tags: ["legal"] }),
  rec({ id: "den-lower", city: "denver ", type: "coworking" }),
  rec({ id: "golden-cowork", city: "Golden", type: "coworking" }),
  rec({ id: "golden-corp", city: "Golden", type: "other", stage: "support", substage: "organizations" }),
  rec({ id: "boulder-accel", city: "Boulder", type: "accelerator" }),
  rec({ id: "state-event", city: "statewide", type: "event" }),
  rec({ id: "online-group", city: "online", type: "community" }),
  rec({ id: "durango-meetup", city: "Durango", type: "community" }),
  rec({ id: "cos-meetup", city: "Colorado Springs", type: "community" }),
  rec({ id: "monument-cowork", city: "Monument", type: "coworking" }),
];
const fixture: GuideInput = { records: FIXTURE, regions: REGIONS, date: DATE };

describe("a city guide on fixtures", () => {
  const denver = buildGuide("startups-in-denver", fixture);

  it("sorts the city's own records by need, in page order, with nearby last", () => {
    expect(denver.sections.map((s) => s.id)).toEqual([
      "accelerators",
      "meet",
      "coworking",
      "investors",
      "support",
      "universities",
      "nearby",
    ]);
    expect(sectionIds(denver, "accelerators")).toEqual(["den-accel", "den-incub"]);
    expect(sectionIds(denver, "meet")).toEqual(["den-meetup", "den-pitch"]);
    expect(sectionIds(denver, "coworking")).toEqual(["den-lower"]);
    expect(sectionIds(denver, "investors")).toEqual(["den-angels", "den-seed", "den-growth"]);
    expect(sectionIds(denver, "support")).toEqual(["den-chamber", "den-class"]);
    expect(sectionIds(denver, "universities")).toEqual(["den-uni"]);
  });

  it("files an angel group under investors, never under where founders meet", () => {
    const investors = denver.sections.find((s) => s.id === "investors")!;
    expect(investors.groups.map((g) => [g.heading, ids(g.items)])).toEqual([
      ["Angel groups", ["den-angels"]],
      ["Seed and early rounds", ["den-seed"]],
      ["Growth rounds", ["den-growth"]],
    ]);
  });

  it("leaves out service providers, coding schools and large companies", () => {
    const listed = new Set(ids(guideItems(denver)));
    for (const id of ["den-lawyer", "den-bootcamp", "golden-corp"]) expect(listed.has(id), id).toBe(false);
  });

  it("lists the region's other towns as nearby, never a city with its own guide, statewide, online or another region", () => {
    expect(sectionIds(denver, "nearby")).toEqual(["golden-cowork"]);
    const listed = new Set(ids(guideItems(denver)));
    for (const id of ["boulder-accel", "state-event", "online-group", "durango-meetup", "cos-meetup", "monument-cowork"]) {
      expect(listed.has(id), id).toBe(false);
    }
  });

  it("links the other city guide in the same region from the nearby section", () => {
    const nearby = denver.sections.find((s) => s.id === "nearby")!;
    expect(links(nearby.intro)).toEqual([{ text: "Boulder", href: "/guides/startups-in-boulder/" }]);
    expect(plainText(nearby.intro)).toBe(
      `Startup Resources lists 1 more in Golden, another town in Photon Mountain, as of ${DATE.label}. Boulder has its own guide.`,
    );
    expect(unsourcedCounts(plainText(nearby.intro), [DATE.label])).toEqual([]);
  });

  it("says other towns, plural, when nearby records come from more than one town", () => {
    const more = [...FIXTURE, rec({ id: "louisville-chamber", city: "Louisville", type: "government" })];
    const nearby = buildGuide("startups-in-denver", { ...fixture, records: more }).sections.find((s) => s.id === "nearby")!;
    expect(sentences(plainText(nearby.intro))[0]).toBe(
      `Startup Resources lists 2 more in Golden and Louisville, other towns in Photon Mountain, as of ${DATE.label}.`,
    );
  });

  it("gives Denver and Boulder the same nearby list, since both are in Photon Mountain", () => {
    const boulder = buildGuide("startups-in-boulder", fixture);
    expect(sectionIds(boulder, "nearby")).toEqual(sectionIds(denver, "nearby"));
    expect(sectionIds(boulder, "accelerators")).toEqual(["boulder-accel"]);
  });

  it("counts every record in the city, listed or not, with its source and date in the same sentence", () => {
    const answer = plainText(denver.answer);
    // 13 records spell their city Denver, one of them "denver " with a stray space.
    expect(sentences(answer)[0]).toBe(
      `Startup Resources lists 13 resources for founders in Denver, as of ${DATE.label}, and the lists below show 11 of them by need.`,
    );
    expect(unsourcedCounts(answer, [DATE.label])).toEqual([]);
    expect(dates(denver.answer)).toEqual([{ text: DATE.label, datetime: DATE.iso }]);
  });

  it("names the city's region, linked to its page, and the region's other core cities", () => {
    expect(links(denver.answer)).toEqual([{ text: "Photon Mountain", href: "/regions/photon-mountain/" }]);
    expect(sentences(plainText(denver.answer))[1]).toBe(
      "Denver is in Photon Mountain, the Colorado Startups region that also takes in Boulder, Golden and Arvada.",
    );
  });

  it("says what the lists cover and why the two counts differ", () => {
    // The two unlisted Denver records are a lawyer and a coding school, so
    // service providers are not most of the rest.
    expect(sentences(plainText(denver.answer))[2]).toBe(
      "The lists cover accelerators and incubators, meetups and events, coworking spaces, investors, support programs and universities, then towns nearby; service providers are left out.",
    );
    const providers = [
      ...FIXTURE,
      rec({ id: "den-accountant", type: "service-provider", stage: "launch", substage: "service-providers" }),
    ];
    expect(plainText(buildGuide("startups-in-denver", { ...fixture, records: providers }).answer)).toMatch(
      /; most of the rest are service providers\.$/,
    );
    const none = FIXTURE.filter((r) => r.type !== "service-provider");
    expect(plainText(buildGuide("startups-in-denver", { ...fixture, records: none }).answer)).toMatch(/then towns nearby\.$/);
  });

  it("names the nearby towns instead when the city is its region's only core city", () => {
    const springs = buildGuide("startups-in-colorado-springs", fixture);
    expect(sentences(plainText(springs.answer))[1]).toBe(
      "Colorado Springs is in Space Peak, the Colorado Startups region that also takes in Manitou Springs, Monument, Fountain, Woodland Park and Cascade.",
    );
    expect(sectionIds(springs, "nearby")).toEqual(["monument-cowork"]);
    expect(links(springs.sections.find((s) => s.id === "nearby")!.intro)).toEqual([]);
  });

  it("drops an empty section, and the answer names only the sections the page shows", () => {
    const springs = buildGuide("startups-in-colorado-springs", fixture);
    expect(springs.sections.map((s) => s.id)).toEqual(["meet", "nearby"]);
    expect(sentences(plainText(springs.answer))[2]).toBe("The lists cover meetups and events, then towns nearby.");
  });

  it("drops the nearby section and its mention when no nearby town has a listing", () => {
    const fortCollins = buildGuide("startups-in-fort-collins", {
      ...fixture,
      records: [rec({ id: "foco-cowork", city: "Fort Collins", type: "coworking" })],
    });
    expect(fortCollins.sections.map((s) => s.id)).toEqual(["coworking"]);
    expect(plainText(fortCollins.answer)).toMatch(/The lists cover coworking spaces\.$/);
  });

  it("reads the region from data/regions/, so a renamed region shows up with no code change", () => {
    const renamed: Region[] = REGIONS.map((r) => (r.id === "photon-mountain" ? { ...r, name: "Test Range", cities: ["Denver", "Golden"] } : r));
    const guide = buildGuide("startups-in-denver", { ...fixture, regions: renamed });
    expect(links(guide.answer)).toEqual([{ text: "Test Range", href: "/regions/photon-mountain/" }]);
    expect(plainText(guide.answer)).toContain("the Colorado Startups region that also takes in Golden.");
    expect(guide.sections.at(-1)?.heading).toBe("Nearby in Test Range");
  });

  it("refuses to build when the city has no region, rather than name a wrong one", () => {
    const noDenver: Region[] = REGIONS.map((r) =>
      r.id === "photon-mountain" ? { ...r, cities: r.cities.filter((c) => c !== "Denver") } : r,
    );
    expect(regionForCity("Denver", noDenver)).toBe(ELSEWHERE);
    expect(() => buildGuide("startups-in-denver", { ...fixture, regions: noDenver })).toThrow(/no region/);
  });
});

describe.each(CITY_SLUGS)("the %s guide on the real data", (slug: CitySlug) => {
  const city = CITY_GUIDES[slug];
  const guide = buildGuide(slug, real);
  const regionId = regionForCity(city, REGIONS);
  const region = REGIONS.find((r) => r.id === regionId)!;
  const own = records.filter((r) => cityKey(r.city) === cityKey(city));
  const answer = plainText(guide.answer);

  it("opens with the city's count and the count the lists show, both sourced and dated", () => {
    const shown = guideItems({ sections: guide.sections.filter((s) => s.id !== "nearby") }).length;
    expect(shown).toBeLessThan(own.length);
    expect(sentences(answer)[0]).toBe(
      `Startup Resources lists ${own.length} resources for founders in ${city}, as of ${DATE.label}, and the lists below show ${shown} of them by need.`,
    );
    expect(unsourcedCounts(answer, [DATE.label])).toEqual([]);
    for (const s of guide.sections) expect(unsourcedCounts(plainText(s.intro), [DATE.label]), s.id).toEqual([]);
  });

  it("names its region from data/regions/ and links the region page", () => {
    expect(region).toBeDefined();
    expect(links(guide.answer)).toContainEqual({ text: region.name, href: `/regions/${region.id}/` });
  });

  it("lists the city's own records in every section but nearby", () => {
    for (const s of guide.sections.filter((x) => x.id !== "nearby")) {
      for (const r of guideItems({ sections: [s] })) expect(cityKey(r.city), `${s.id}: ${r.id}`).toBe(cityKey(city));
    }
  });

  it("lists every own record a need picks, once", () => {
    const want = own.filter((r) => CITY_NEEDS.some((n) => n.pick(r))).map((r) => r.id);
    const got = guideItems({ sections: guide.sections.filter((s) => s.id !== "nearby") }).map((r) => r.id);
    expect([...got].sort()).toEqual([...want].sort());
    expect(duplicates(guide)).toEqual([]);
  });

  it("keeps nearby records in the region, outside every city that has a guide", () => {
    const guided = new Set(Object.values(CITY_GUIDES).map(cityKey));
    for (const r of sectionIds(guide, "nearby").map((id) => records.find((x) => x.id === id)!)) {
      expect(regionForCity(r.city, REGIONS), r.id).toBe(region.id);
      expect(guided.has(cityKey(r.city)), r.id).toBe(false);
    }
  });

  it("never lists a statewide or online record", () => {
    expect(guideItems(guide).filter((r) => ["statewide", "online"].includes(r.city))).toEqual([]);
  });

  it("keeps the investor and funding sections free of the Leaderboard (hard constraint 8)", () => {
    for (const s of guide.sections.filter((x) => ["investors", "support"].includes(x.id))) {
      expect(JSON.stringify(s), s.id).not.toMatch(/leaderboard/i);
    }
    expect(JSON.stringify(guide)).not.toContain("coloradoai.us");
  });

  it("makes no superlative claim in its own words", () => {
    const words = [answer, ...guide.sections.flatMap((s) => [s.heading, plainText(s.intro)])].join(" ");
    expect(words).not.toMatch(/\b(?:hub|best|leading|top|largest|biggest|fastest-growing|premier)\b/i);
  });

  it("builds one ItemList of plain ListItems, in page order", () => {
    const ld = guideJsonLd(guide, SITE) as { "@type": string; itemListElement: Record<string, unknown>[] };
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.itemListElement.map((e) => e.url)).toEqual(guideItems(guide).map((r) => r.url));
    for (const e of ld.itemListElement) expect(Object.keys(e).sort()).toEqual(["@type", "name", "position", "url"]);
    expect(JSON.stringify(ld)).not.toContain("@id");
  });
});

// The calendar fixture: offsets as the feed writes them, plus two UTC times
// that land on the previous day in Denver, one on each side of the switch to
// standard time (November 1, 2026).
const event = (over: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "start" | "end">): CalendarEvent => ({
  title: over.id,
  allDay: false,
  location: null,
  url: `https://example.org/${over.id}`,
  inPerson: false,
  ...over,
});
const snapshot = (events: CalendarEvent[], fetchedAt = "2026-10-19T00:21:08.271Z"): Snapshot => ({
  source: "https://calendar.google.com/calendar/ical/test/public/basic.ics",
  fetchedAt,
  timeZone: "America/Denver",
  windowDays: 60,
  events,
});
const NOW = new Date("2026-10-19T15:00:00Z");

describe("the events guide's upcoming list", () => {
  it("shows the next events in Mountain Time, as <time> values the calendar gave", () => {
    const list = upcomingList({
      now: NOW,
      snapshot: snapshot([
        event({ id: "late-utc", start: "2026-10-22T03:00:00+00:00", end: "2026-10-22T04:00:00+00:00" }),
        event({ id: "after-dst", start: "2026-11-05T01:30:00+00:00", end: "2026-11-05T03:00:00+00:00" }),
        event({ id: "all-day", start: "2026-10-24", end: "2026-10-24", allDay: true }),
        event({
          id: "coffee",
          start: "2026-10-20T08:00:00-06:00",
          end: "2026-10-20T09:00:00-06:00",
          location: "Enterprise Coworking RiNo, 3000 Lawrence St, Denver, CO 80205, USA",
        }),
      ]),
    })!;
    expect(list.events.map((e) => [e.id, e.day, e.time, e.datetime])).toEqual([
      ["coffee", "Tue, Oct 20", "8:00 AM to 9:00 AM", "2026-10-20T08:00:00-06:00"],
      ["late-utc", "Wed, Oct 21", "9:00 PM to 10:00 PM", "2026-10-22T03:00:00+00:00"],
      ["all-day", "Sat, Oct 24", "All day", "2026-10-24"],
      ["after-dst", "Wed, Nov 4", "6:30 PM to 8:00 PM", "2026-11-05T01:30:00+00:00"],
    ]);
    expect(list.events[0]?.where).toBe("Enterprise Coworking RiNo, 3000 Lawrence St, Denver, CO 80205");
  });

  it("drops events that have ended and stops at the limit", () => {
    const many = Array.from({ length: UPCOMING_LIMIT + 5 }, (_, i) => {
      const day = String(20 + Math.floor(i / 2)).padStart(2, "0");
      const hour = i % 2 === 0 ? "08" : "17";
      return event({ id: `e${i}`, start: `2026-10-${day}T${hour}:00:00-06:00`, end: `2026-10-${day}T${hour}:30:00-06:00` });
    });
    const past = event({ id: "past", start: "2026-10-18T08:00:00-06:00", end: "2026-10-18T09:00:00-06:00" });
    const list = upcomingList({ now: NOW, snapshot: snapshot([past, ...many]) })!;
    expect(list.events).toHaveLength(UPCOMING_LIMIT);
    expect(list.events.map((e) => e.id)).toEqual(many.slice(0, UPCOMING_LIMIT).map((e) => e.id));
    expect(UPCOMING_LIMIT).toBeGreaterThanOrEqual(10);
    expect(UPCOMING_LIMIT).toBeLessThanOrEqual(15);
  });

  it("dates the list twice: as of the build, which drops ended events, and as the calendar was read", () => {
    const list = upcomingList({
      now: NOW,
      snapshot: snapshot([
        event({ id: "a", start: "2026-10-20T08:00:00-06:00", end: "2026-10-20T09:00:00-06:00" }),
        event({ id: "b", start: "2026-10-21T08:00:00-06:00", end: "2026-10-21T09:00:00-06:00" }),
      ]),
    })!;
    // Built at 15:00 UTC on October 19. Fetched at 00:21 UTC on October 19,
    // which is still October 18 in Denver.
    expect(dates(list.intro)).toEqual([
      { text: "October 19, 2026", datetime: "2026-10-19" },
      { text: "October 18, 2026", datetime: "2026-10-18" },
    ]);
    expect(sentences(plainText(list.intro)).slice(0, 2)).toEqual([
      "The next 2 events on the Colorado Startups event calendar as of October 19, 2026, when this page was built.",
      "They come from the calendar as read on October 18, 2026.",
    ]);
    expect(unsourcedCounts(plainText(list.intro), ["October 19, 2026", "October 18, 2026"])).toEqual([]);
    expect(links(list.intro)).toEqual([{ text: "See every event on the calendar", href: EVENT_CALENDAR }]);
  });

  it("speaks of one event in the singular", () => {
    const list = upcomingList({
      now: NOW,
      snapshot: snapshot([event({ id: "a", start: "2026-10-20T08:00:00-06:00", end: "2026-10-20T09:00:00-06:00" })]),
    })!;
    expect(sentences(plainText(list.intro)).slice(0, 2)).toEqual([
      "The next event on the Colorado Startups event calendar as of October 19, 2026, when this page was built.",
      "It comes from the calendar as read on October 18, 2026.",
    ]);
  });

  it("shows nothing when there is no snapshot, no event left, or no readable fetch date", () => {
    const one = [event({ id: "a", start: "2026-10-20T08:00:00-06:00", end: "2026-10-20T09:00:00-06:00" })];
    expect(upcomingList(undefined)).toBeUndefined();
    expect(upcomingList({ now: NOW, snapshot: null })).toBeUndefined();
    expect(upcomingList({ now: NOW, snapshot: snapshot([]) })).toBeUndefined();
    expect(upcomingList({ now: new Date("2027-01-01T00:00:00Z"), snapshot: snapshot(one) })).toBeUndefined();
    expect(upcomingList({ now: NOW, snapshot: snapshot(one, "yesterday") })).toBeUndefined();
    expect(upcomingList({ now: NOW, snapshot: snapshot(one) })?.events).toHaveLength(1);
  });
});

describe("the events guide", () => {
  const series = records.filter((r) => r.type === "event");
  const empty = buildGuide("colorado-startup-events", real);
  const withEvents = buildGuide("colorado-startup-events", {
    ...real,
    calendar: {
      now: NOW,
      snapshot: snapshot([event({ id: "a", start: "2026-10-20T08:00:00-06:00", end: "2026-10-20T09:00:00-06:00" })]),
    },
  });

  it("answers with the event calendar, linked, and the count of event records, sourced", () => {
    expect(links(empty.answer)).toEqual([{ text: "Colorado Startups event calendar", href: EVENT_CALENDAR }]);
    const text = plainText(empty.answer);
    expect(sentences(text)).toHaveLength(2);
    expect(sentences(text)[1]).toBe(
      `Below, by city, are the ${series.length} events, groups and maker spaces that Startup Resources lists as events, as of ${DATE.label}.`,
    );
    expect(unsourcedCounts(text, [DATE.label])).toEqual([]);
  });

  it("with no calendar events, shows the event records and the calendar link only", () => {
    expect(empty.upcoming).toBeUndefined();
    expect(empty.sections.map((s) => s.id)).toEqual(["by-city"]);
    expect(empty.sections[0]?.heading).toBe("Events and groups by city");
  });

  it("with calendar events, adds them ahead of the lists and says so in the answer", () => {
    expect(withEvents.upcoming?.events.map((e) => e.id)).toEqual(["a"]);
    expect(sentences(plainText(withEvents.answer))).toHaveLength(3);
    expect(plainText(withEvents.answer)).toMatch(/Mountain Time\.$/);
  });

  it("lists every active event record once, by city A to Z, with statewide and online last", () => {
    expect([...ids(guideItems(empty))].sort()).toEqual(ids(series).sort());
    expect(duplicates(empty)).toEqual([]);
    const headings = empty.sections[0]!.groups.map((g) => g.heading);
    const places = headings.filter((h) => h !== "Statewide" && h !== "Online");
    expect(places).toEqual([...places].sort((a, b) => a!.localeCompare(b!, "en")));
    expect(headings.slice(places.length)).toEqual(headings.filter((h) => h === "Statewide" || h === "Online"));
  });

  it("groups fixture records by city, never twice", () => {
    const groups = byCity([
      rec({ id: "s", city: "statewide", type: "event" }),
      rec({ id: "o", city: "online", type: "event" }),
      rec({ id: "d", city: "Denver", type: "event" }),
      rec({ id: "b", city: "Boulder", type: "event" }),
      rec({ id: "d2", city: "Denver", type: "event" }),
    ]);
    expect(groups.map((g) => [g.heading, ids(g.items)])).toEqual([
      ["Boulder", ["b"]],
      ["Denver", ["d", "d2"]],
      ["Statewide", ["s"]],
      ["Online", ["o"]],
    ]);
  });

  it("carries one ItemList of the event records only, never Event markup or the calendar's events", () => {
    const ld = guideJsonLd(withEvents, SITE);
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(series.length);
    const json = JSON.stringify(ld);
    expect(json).not.toMatch(/"Event"|startDate/);
    expect(json).not.toContain("https://example.org/a");
  });
});
