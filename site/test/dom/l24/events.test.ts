// /event-calendar/ as it ships: the next six events are cards above the
// iframe, built from the snapshot the build read, and the page's one JSON-LD
// block names only the in-person events those six cards show. Run
// `npm run build` first (test:content does).
import { describe, expect, it } from "vitest";

import { cardPlace, dateParts, endsAt, NEXT_COUNT, SNAPSHOT, shownLocation, whenText } from "../../../src/components/events/events";
import { readDist } from "../pages";

const page = new DOMParser().parseFromString(readDist("event-calendar/index.html"), "text/html");
const main = page.querySelector("main")!;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const cards = [...main.querySelectorAll<HTMLElement>(".next li.ev-card")].map((li) => ({
  li,
  hidden: li.hidden,
  datetime: li.querySelector("time")?.getAttribute("datetime") ?? "",
  date: [...li.querySelectorAll(".ev-card__date span")].map((span) => text(span)).join(" "),
  dateText: text(li.querySelector(".ev-card__date")),
  title: text(li.querySelector(".ev-card__title")),
  href: li.querySelector(".ev-card__title a")?.getAttribute("href") ?? null,
  time: text(li.querySelector(".ev-card__time")),
  place: li.querySelector(".ev-card__place") ? text(li.querySelector(".ev-card__place")) : null,
}));
const shown = cards.filter((c) => !c.hidden);
const snapshotEvents = SNAPSHOT?.events ?? [];
const key = (e: { start: string; title: string }) => `${e.start} ${e.title}`;
const bySnapshotKey = new Map(snapshotEvents.map((e) => [key(e), e]));
const eventOf = (c: { datetime: string; title: string }) => bySnapshotKey.get(`${c.datetime} ${c.title}`)!;

describe("/event-calendar/ next events", () => {
  it("puts the cards above the calendar iframe, with no intro paragraph", () => {
    const heading = page.getElementById("next-events")!;
    const frame = main.querySelector("iframe")!;
    expect(heading.tagName).toBe("H2");
    expect(heading.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.getElementById("full-calendar")?.tagName).toBe("H2");
    expect(main.querySelector(".info-header .lede")).toBeNull();
  });

  it("shows the next six, soonest first, and holds the rest hidden for the script", () => {
    expect(shown.length).toBe(Math.min(NEXT_COUNT, cards.length));
    expect(cards.slice(0, NEXT_COUNT).every((c) => !c.hidden)).toBe(true);
    expect(cards.slice(NEXT_COUNT).every((c) => c.hidden)).toBe(true);
    const starts = cards.map((c) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(c.datetime) ? `${c.datetime}T12:00:00Z` : c.datetime));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("holds only snapshot events, and every one that has not ended", () => {
    // The build ran a moment before this test, so anything still upcoming now
    // was upcoming then. Anything listed must come from the snapshot.
    for (const c of cards) expect(bySnapshotKey.has(`${c.datetime} ${c.title}`), c.title).toBe(true);
    const listed = new Set(cards.map((c) => `${c.datetime} ${c.title}`));
    for (const e of snapshotEvents.filter((ev) => endsAt(ev) > Date.now())) expect(listed.has(key(e)), e.title).toBe(true);
  });

  it("gives each card its date and time in Mountain Time, its title, link and place", () => {
    for (const c of cards) {
      const e = eventOf(c);
      const d = dateParts(e);
      expect(c.date).toBe(`${d.month} ${d.day} ${d.weekday}`);
      // Spaces between the parts, so a screen reader hears "Nov 17 Tue".
      expect(c.dateText).toBe(c.date);
      expect(c.time).toBe(whenText(e).time);
      expect(c.href).toBe(e.url);
      expect(c.place).toBe(e.location ? cardPlace(e.location) : null);
    }
  });

  // The page's script moves the six along by this instant (#225).
  it("stamps each card with when it ends, and ships the empty message", () => {
    for (const c of cards) expect(c.li.dataset.ends).toBe(new Date(endsAt(eventOf(c))).toISOString());
    expect(main.querySelector<HTMLElement>(".next")?.dataset.count).toBe(String(NEXT_COUNT));
    expect(main.querySelector(".next [data-events-empty]")).not.toBeNull();
  });

  it("links the full calendar, and says so when no card is listed", () => {
    expect(main.querySelector('.next a[href="#full-calendar"]')).not.toBeNull();
    if (cards.length > 0) return;
    expect(text(main.querySelector(".next [data-events-empty]"))).toMatch(/The full calendar below/);
  });
});

describe("/event-calendar/ Event JSON-LD", () => {
  const blocks = [...page.querySelectorAll('script[type="application/ld+json"]')];
  const graph = blocks.length
    ? ((JSON.parse(blocks[0].textContent ?? "{}") as { "@graph": Record<string, unknown>[] })["@graph"] ?? [])
    : [];
  const inPersonShown = shown.filter((c) => eventOf(c).inPerson && eventOf(c).location);

  it("ships one block, and only when a shown card is in person", () => {
    expect(blocks.length).toBe(inPersonShown.length > 0 ? 1 : 0);
  });

  it("describes each shown in-person event, with name, start date and its full address", () => {
    expect(graph.length).toBe(inPersonShown.length);
    for (const node of graph) {
      expect(node["@type"]).toBe("Event");
      expect(node.startDate).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/);
      const card = shown.find((c) => c.title === node.name && c.datetime === node.startDate);
      expect(card, String(node.name)).toBeDefined();
      const place = node.location as Record<string, string>;
      expect(place["@type"]).toBe("Place");
      expect(place.address).toBe(shownLocation(eventOf(card!)));
    }
  });

  it("leaves online events out", () => {
    for (const c of shown.filter((s) => !eventOf(s).inPerson)) {
      expect(graph.some((n) => n.name === c.title && n.startDate === c.datetime), c.title).toBe(false);
    }
  });
});
