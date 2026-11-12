// L32 over the built site (run `npm run build` first; test:content does): the
// four city guides and the events guide answer first, source every count in
// the same sentence, carry one ItemList and no Event markup, and keep every
// list out of the search index. test/dom/l23/ also runs its shared checks
// (links, sitemap, headings, axe) on these pages.
import { describe, expect, it } from "vitest";

import { SNAPSHOT, upcomingEvents, whenText } from "../../../src/components/events/events";
import {
  asOf,
  CITY_GUIDES,
  CITY_SLUGS,
  EVENT_CALENDAR,
  GUIDE_GROUPS,
  GUIDE_SLUGS,
  GUIDES,
  UPCOMING_LIMIT,
  type GuideSlug,
} from "../../../src/lib/guides/guides";
import { REGIONS, regionForCity } from "../../../src/lib/regions/match";
import { readDist } from "../pages";

const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x !== "");
const file = (slug: GuideSlug) => `guides/${slug}/index.html`;

/**
 * What is wrong with how a guide page opens and states its counts.
 *   - The answer ([data-guide-answer]) is the first paragraph in <main>, in
 *     the same section as the h1, with no list before it.
 *   - Every sentence of the answer and of each section intro (the paragraph
 *     under an h2) that states a number names its source (Startup Resources or
 *     the event calendar) and says "as of" a date the page prints in <time>.
 * Empty when the page is right.
 */
export function pageProblems(html: string): string[] {
  const main = parseHtml(html).querySelector("main");
  if (!main) return ["no <main>"];
  const problems: string[] = [];
  const answer = main.querySelector("[data-guide-answer]");
  if (!answer) return ["no [data-guide-answer] paragraph"];
  if (main.querySelector("p") !== answer) problems.push("the answer is not the first paragraph in <main>");
  if (!answer.closest("section")?.querySelector("h1")) problems.push("the answer is not in the h1's section");
  const list = main.querySelector("ul[data-guide-list], ol[data-event-list]");
  if (list && list.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING) {
    problems.push("a list comes before the answer");
  }

  const dates = [...main.querySelectorAll("time")].map((t) => text(t));
  for (const p of [answer, ...main.querySelectorAll("h2 + p")]) {
    for (const s of sentences(text(p))) {
      const bare = dates.reduce((t, d) => t.replaceAll(d, ""), s);
      if (!/\d/.test(bare)) continue;
      const sourced = /Startup Resources|event calendar/.test(s);
      const dated = dates.some((d) => s.includes(`as of ${d}`));
      if (!sourced || !dated) problems.push(`unsourced count: "${s}"`);
    }
  }
  return problems;
}

describe("pageProblems self-test", () => {
  const page = (body: string) => `<!doctype html><html><body><main>${body}</main></body></html>`;
  const answer = (count: string) =>
    `<section><h1>Guide</h1><p data-guide-answer>${count} Denver is in Photon Mountain.</p></section>`;
  const today = `<time datetime="2026-10-18">October 18, 2026</time>`;
  const list = `<section><h2>List</h2><p>Programs.</p><ul data-guide-list><li>One</li></ul></section>`;

  it("passes a page whose answer comes first and whose counts are sourced and dated", () => {
    expect(pageProblems(page(answer(`Startup Resources lists 12 resources in Denver, as of ${today}.`) + list))).toEqual([]);
  });

  it("flags a bare count, a count with no date and a count with no source", () => {
    for (const count of [
      "Denver has 12 accelerators.",
      "Startup Resources lists 12 resources in Denver.",
      `Our list has 12 resources, as of ${today}.`,
    ]) {
      expect(pageProblems(page(answer(count) + list)), count).toHaveLength(1);
    }
  });

  it("flags a count in a section intro too", () => {
    const intro = `<section><h2>Investors</h2><p>Denver has 9 seed funds.</p><ul data-guide-list><li>A</li></ul></section>`;
    expect(pageProblems(page(answer(`Startup Resources lists 2, as of ${today}.`) + intro))).toEqual([
      'unsourced count: "Denver has 9 seed funds."',
    ]);
  });

  it("flags an answer that is not the first paragraph, or that comes after a list", () => {
    const first = `<section><h1>Guide</h1><p>Intro first.</p><p data-guide-answer>The answer.</p></section>`;
    expect(pageProblems(page(first))).toContain("the answer is not the first paragraph in <main>");
    const late = `<section><h1>Guide</h1></section><ul data-guide-list><li>A</li></ul><section><p data-guide-answer>Late.</p></section>`;
    expect(pageProblems(page(late))).toEqual(
      expect.arrayContaining(["the answer is not in the h1's section", "a list comes before the answer"]),
    );
  });
});

const L32 = [...CITY_SLUGS, "colorado-startup-events"] as const;

describe.each(L32)("/guides/%s/", (slug) => {
  const html = readDist(file(slug));
  const page = parseHtml(html);
  const main = page.querySelector("main")!;

  it("answers first and sources every count in the same sentence", () => {
    expect(pageProblems(html)).toEqual([]);
  });

  it("has its title as the h1", () => {
    expect(text(page.querySelector("h1"))).toBe(GUIDES[slug].title);
  });

  it("carries one JSON-LD block: an ItemList of plain ListItems, with no @id and no Event", () => {
    const blocks = page.querySelectorAll("script[type='application/ld+json']");
    expect(blocks).toHaveLength(1);
    const raw = blocks[0]!.textContent ?? "";
    const ld = JSON.parse(raw);
    expect(ld["@type"]).toBe("ItemList");
    expect(raw).not.toContain("@id");
    expect(raw).not.toMatch(/"Event"|"Organization"/);
    for (const e of ld.itemListElement) expect(Object.keys(e).sort()).toEqual(["@type", "name", "position", "url"]);
    expect(ld.numberOfItems).toBe(main.querySelectorAll("[data-guide-item]").length);
  });

  it("keeps every list out of the search index, the answer and headings in it", () => {
    const lists = [...main.querySelectorAll("ul[data-guide-list], ol[data-event-list]")];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) expect(list.closest("[data-pagefind-ignore]")).not.toBeNull();
    expect(main.querySelector("[data-guide-answer]")?.closest("[data-pagefind-ignore]")).toBeNull();
    for (const h of main.querySelectorAll("h1, h2")) expect(h.closest("[data-pagefind-ignore]"), text(h)).toBeNull();
  });

  it("links the other eight guides once each, grouped", () => {
    const more = main.querySelector("section[aria-labelledby='more-title']")!;
    const hrefs = [...more.querySelectorAll(".more a")].map((a) => a.getAttribute("href"));
    expect([...hrefs].sort()).toEqual(GUIDE_SLUGS.filter((s) => s !== slug).map((s) => `/guides/${s}/`).sort());
    expect(more.querySelectorAll(".more h3").length).toBeLessThanOrEqual(GUIDE_GROUPS.length);
  });

  it("never links the Leaderboard or coloradoai.us", () => {
    expect(main.querySelector("a[href*='/leaderboard']")).toBeNull();
    expect(html).not.toContain("coloradoai.us");
  });
});

describe.each(CITY_SLUGS)("/guides/%s/ city rules", (slug) => {
  const city = CITY_GUIDES[slug];
  const main = parseHtml(readDist(file(slug))).querySelector("main")!;
  const region = REGIONS.find((r) => r.id === regionForCity(city, REGIONS))!;
  const cityOf = (li: Element) => text(li.querySelector(".meta")).split(", ").slice(1).join(", ");

  it("names the city's region in the answer, linked to the region page", () => {
    const answer = main.querySelector("[data-guide-answer]")!;
    expect(text(answer)).toContain(`${city} is in ${region.name}`);
    expect(text(answer.querySelector(`a[href='/regions/${region.id}/']`))).toBe(region.name);
  });

  it("states the count the lists show, and the nearby count, each matching the page", () => {
    const answer = text(main.querySelector("[data-guide-answer]"));
    const all = main.querySelectorAll("[data-guide-item]").length;
    const nearby = main.querySelectorAll("section#nearby [data-guide-item]").length;
    expect(answer).toContain(`, and the lists below show ${all - nearby} of them by need.`);
    if (nearby > 0) expect(text(main.querySelector("section#nearby h2 + p"))).toMatch(new RegExp(`^Startup Resources lists ${nearby} more in `));
  });

  it("lists the city's own records before nearby, and none from statewide or online", () => {
    const items = [...main.querySelectorAll("[data-guide-item]")];
    const nearby = new Set(main.querySelectorAll("section#nearby [data-guide-item]"));
    for (const li of items) {
      const where = cityOf(li);
      expect(["Statewide", "Online"], where).not.toContain(where);
      if (nearby.has(li)) expect(where).not.toBe(city);
      else expect(where).toBe(city);
    }
  });
});

describe("/guides/colorado-startup-events/", () => {
  const main = parseHtml(readDist(file("colorado-startup-events"))).querySelector("main")!;
  const answer = main.querySelector("[data-guide-answer]")!;
  const upcoming = main.querySelector("[data-guide-upcoming]");

  it("points the answer at the event calendar", () => {
    expect(answer.querySelector(`a[href='${EVENT_CALENDAR}']`)).not.toBeNull();
  });

  it("lists the event records by city, under a heading that does not call them all recurring", () => {
    const byCity = main.querySelector("section#by-city")!;
    expect(text(byCity.querySelector("h2"))).toBe("Events and groups by city");
    expect(byCity.querySelectorAll("h3").length).toBeGreaterThan(0);
    expect(byCity.querySelectorAll("[data-guide-item]").length).toBe(main.querySelectorAll("[data-guide-item]").length);
    expect(text(main)).not.toMatch(/recurring/i);
  });

  // The build drops events that ended before it ran; what is left depends on
  // the day, so the page shows the list or the empty state, never a broken one.
  it("shows the calendar's next events with their source and date, or the series and calendar link only", () => {
    const stillAhead = upcomingEvents(SNAPSHOT, new Date()).length;
    if (!upcoming) {
      expect(stillAhead, "events lie ahead but the page shows none").toBe(0);
      expect(main.querySelector("ol[data-event-list]")).toBeNull();
      expect(sentences(text(answer))).toHaveLength(2);
      return;
    }
    const items = [...upcoming.querySelectorAll("ol[data-event-list] > li")];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(UPCOMING_LIMIT);
    // Two dates: the build's, which the answer also prints, and the calendar read's.
    const fetched = asOf(new Date(SNAPSHOT!.fetchedAt)).label;
    const built = text(answer.querySelector("time"));
    const intro = upcoming.querySelector("h2 + p")!;
    expect(text(intro)).toContain(`on the Colorado Startups event calendar as of ${built}, when this page was built.`);
    expect(text(intro)).toContain(`from the calendar as read on ${fetched}.`);
    expect([...intro.querySelectorAll("time")].map((t) => text(t))).toEqual([built, fetched]);
    expect(upcoming.querySelector(`a[href='${EVENT_CALENDAR}']`)).not.toBeNull();
  });

  it("prints each event's day in Mountain Time inside a <time> carrying the calendar's start", () => {
    if (!upcoming) return;
    for (const li of upcoming.querySelectorAll("ol[data-event-list] > li")) {
      const time = li.querySelector("time");
      const start = time?.getAttribute("datetime") ?? "";
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/);
      const source = SNAPSHOT!.events.find((e) => e.start === start && e.title === text(li.querySelector(".name")));
      expect(source, start).toBeDefined();
      expect(text(time)).toBe(whenText(source!).day);
      expect(text(li.querySelector(".when"))).toBe(`${whenText(source!).day} ${whenText(source!).time}`);
    }
  });
});

describe("/guides/ index", () => {
  const main = parseHtml(readDist("guides/index.html")).querySelector("main")!;

  // S7 added the startup credits guide after the groups; its programs are not
  // Startup Resources records, so it has no slug in GUIDE_GROUPS.
  it("lists all nine guides once each, under their group headings, then the startup credits guide", () => {
    const hrefs = [...main.querySelectorAll("[data-guide-item] h3 a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([...GUIDE_GROUPS.flatMap((g) => g.slugs).map((s) => `/guides/${s}/`), "/guides/startup-credits/"]);
    const headings = [...main.querySelectorAll("h2")].map((h) => text(h));
    for (const g of GUIDE_GROUPS) expect(headings).toContain(g.heading);
  });
});
