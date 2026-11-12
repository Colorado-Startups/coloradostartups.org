// /event-calendar/ as it ships: the upcoming-events list is HTML above the
// iframe, it matches the snapshot the build read, and the page's one JSON-LD
// block names only the in-person events it lists. Run `npm run build` first
// (test:content does).
import { describe, expect, it } from "vitest";

import { endsAt, SNAPSHOT, shownLocation, whenText } from "../../../src/components/events/events";
import { readDist } from "../pages";

const page = new DOMParser().parseFromString(readDist("event-calendar/index.html"), "text/html");
const main = page.querySelector("main")!;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const items = [...main.querySelectorAll(".upcoming li.event")].map((li) => ({
  datetime: li.querySelector("time")?.getAttribute("datetime") ?? "",
  when: text(li.querySelector(".when")),
  title: text(li.querySelector(".name")),
  href: li.querySelector(".name a")?.getAttribute("href") ?? null,
  where: li.querySelector(".where") ? text(li.querySelector(".where")) : null,
}));
const snapshotEvents = SNAPSHOT?.events ?? [];
const key = (e: { start: string; title: string }) => `${e.start} ${e.title}`;
const bySnapshotKey = new Map(snapshotEvents.map((e) => [key(e), e]));

describe("/event-calendar/ upcoming events", () => {
  it("puts the list above the calendar iframe", () => {
    const list = page.getElementById("upcoming-events")!;
    const frame = main.querySelector("iframe")!;
    expect(list.tagName).toBe("H2");
    expect(list.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.getElementById("full-calendar")?.tagName).toBe("H2");
  });

  it("links the full calendar from the list's introduction", () => {
    if (items.length === 0) return;
    expect(main.querySelector('.upcoming a[href="#full-calendar"]')).not.toBeNull();
  });

  it("lists only snapshot events, and every one that has not ended", () => {
    // The build ran a moment before this test, so anything still upcoming now
    // was upcoming then. Anything listed must come from the snapshot.
    for (const item of items) expect(bySnapshotKey.has(`${item.datetime} ${item.title}`), item.title).toBe(true);
    const listed = new Set(items.map((i) => `${i.datetime} ${i.title}`));
    for (const e of snapshotEvents.filter((ev) => endsAt(ev) > Date.now())) expect(listed.has(key(e)), e.title).toBe(true);
  });

  it("shows each event's day and time in Mountain Time, its link and its place", () => {
    for (const item of items) {
      const e = bySnapshotKey.get(`${item.datetime} ${item.title}`)!;
      const when = whenText(e);
      expect(item.when).toBe(`${when.day} ${when.time}`);
      expect(item.href).toBe(e.url);
      expect(item.where).toBe(shownLocation(e));
    }
  });

  // The page's script hides events by this instant once they end (#225).
  it("stamps each event with when it ends, for the script that hides ended events", () => {
    for (const li of main.querySelectorAll<HTMLElement>(".upcoming li.event")) {
      const datetime = li.querySelector("time")?.getAttribute("datetime") ?? "";
      const e = bySnapshotKey.get(`${datetime} ${text(li.querySelector(".name"))}`)!;
      expect(li.dataset.ends).toBe(new Date(endsAt(e)).toISOString());
    }
    expect(main.querySelector(".upcoming [data-events-empty]")).not.toBeNull();
  });

  it("says so, and points to the calendar, when nothing is listed", () => {
    if (items.length > 0) return;
    expect(text(main.querySelector(".upcoming"))).toMatch(/The full calendar below/);
  });

  it("groups the list under month headings, in date order", () => {
    const months = [...main.querySelectorAll(".upcoming h3")].map(text);
    expect(months.every((m) => /^[A-Z][a-z]+ \d{4}$/.test(m))).toBe(true);
    const starts = items.map((i) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(i.datetime) ? `${i.datetime}T12:00:00Z` : i.datetime));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe("/event-calendar/ Event JSON-LD", () => {
  const blocks = [...page.querySelectorAll('script[type="application/ld+json"]')];
  const graph = blocks.length
    ? ((JSON.parse(blocks[0].textContent ?? "{}") as { "@graph": Record<string, unknown>[] })["@graph"] ?? [])
    : [];
  const inPersonListed = items.filter((i) => bySnapshotKey.get(`${i.datetime} ${i.title}`)?.inPerson && i.where);

  it("ships one block, and only when there are in-person events to describe", () => {
    expect(blocks.length).toBe(inPersonListed.length > 0 ? 1 : 0);
  });

  it("describes each listed in-person event, with name, start date and a place", () => {
    expect(graph.length).toBe(inPersonListed.length);
    for (const node of graph) {
      expect(node["@type"]).toBe("Event");
      expect(typeof node.name).toBe("string");
      expect(node.startDate).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/);
      const place = node.location as Record<string, string>;
      expect(place["@type"]).toBe("Place");
      expect(place.address).toBeTruthy();
      const listed = items.find((i) => i.title === node.name && i.datetime === node.startDate);
      expect(listed, String(node.name)).toBeDefined();
      expect(place.address).toBe(listed!.where);
    }
  });

  it("leaves online events out", () => {
    const online = items.filter((i) => !bySnapshotKey.get(`${i.datetime} ${i.title}`)?.inPerson);
    for (const item of online) {
      expect(graph.some((n) => n.name === item.title && n.startDate === item.datetime), item.title).toBe(false);
    }
  });
});
