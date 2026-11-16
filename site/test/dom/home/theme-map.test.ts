import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { type CalendarEvent, startsAt } from "../../../src/components/events/events";
import { readDist } from "../pages";

// The home page's maps (ColoradoMap.astro): the statewide map as a drawing over
// its relief image, and each Why Colorado panel's header, the real map of its
// region as one link to the region's page. No live map and no MapLibre here.
const parse = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");
const home = parse("index.html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("home maps", () => {
  it("draws the statewide map over its relief, with a focusable link on each zone", () => {
    const map = home.querySelector("figure#home-map")!;
    expect(map.querySelector("img.colorado-map__relief")?.getAttribute("loading")).toBe("lazy");
    expect(map.querySelector(".colorado-map__drawing svg[role='img']")).not.toBeNull();
    expect(map.hasAttribute("data-colorado-map"), "no live map on the home page").toBe(false);
    const hits = [...map.querySelectorAll<HTMLAnchorElement>("a.colorado-map__hit")];
    expect(hits.map((a) => a.getAttribute("href")).sort()).toEqual(REGION_IDS.map((id) => `/regions/${id}/`).sort());
    // Step W2: each zone takes keyboard focus and has its own name.
    for (const a of hits) {
      expect(a.hasAttribute("tabindex"), "in the tab order").toBe(false);
      expect(a.hasAttribute("aria-hidden"), "in the accessibility tree").toBe(false);
      expect(a.getAttribute("aria-label")).toMatch(/ on the map$/);
    }
  });

  it.each(REGION_IDS)("heads the %s panel with its real map, linked to its page", (id) => {
    const panel = home.querySelector(`#theme-${id}`)!.closest("article")!;
    const link = panel.querySelector<HTMLAnchorElement>("a.colorado-map--thumb")!;
    expect(link.getAttribute("href")).toBe(`/regions/${id}/`);
    const svg = link.querySelector("svg[role='img']")!;
    expect(svg.getAttribute("aria-label")).toMatch(/^Map of /);
    const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(width! / height!).toBeCloseTo(16 / 9, 1);
    const relief = link.querySelector<HTMLImageElement>("img.colorado-map__relief")!;
    expect(relief.getAttribute("alt")).toBe("");
    expect(relief.getAttribute("loading")).toBe("lazy");
    // The painting is the region page's full art now, not the card's header.
    expect(panel.querySelector("img.theme__art")).toBeNull();
  });
});

// Step W2, the living map: each zone is the entrance to its region. A card per
// zone shows its crest, name and three counts; the table beside the map shows
// the same, so nothing depends on hover. The counts match the region pages.
const COUNTS = ["companies", "events", "resources"] as const;
const nums = (root: Element, sel: (key: string) => string) => COUNTS.map((k) => text(root.querySelector(sel(k))));
const table = home.querySelector<HTMLTableElement>("table[data-zone-counts]")!;
const cardOf = (id: string) => home.querySelector(`#home-map .colorado-map__card[data-zone='${id}']`)!;

describe("living home map", () => {
  it("loads no MapLibre and no live map on home", () => {
    expect(home.querySelector("[data-colorado-map], [data-map-canvas]")).toBeNull();
    const scripts = [...home.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")!);
    expect(scripts.some((s) => /maplibre/i.test(s))).toBe(false);
    for (const s of home.querySelectorAll("script:not([src])")) expect(s.textContent ?? "").not.toMatch(/maplibre/i);
  });

  it.each(REGION_IDS)("gives the %s zone a card with a crest, a name and three numbers", (id) => {
    const card = cardOf(id);
    expect(card, id).not.toBeNull();
    expect(card.previousElementSibling?.matches(`a.colorado-map__hit[data-zone='${id}']`), "the card follows its zone").toBe(true);
    const crest = card.querySelector<HTMLImageElement>("img.colorado-map__crest")!;
    expect(crest.getAttribute("src")).toBe(`/art/brand/${id}-512-512.webp`);
    expect(Number(crest.getAttribute("width"))).toBeGreaterThanOrEqual(32);
    expect(text(card.querySelector(".colorado-map__card-name")).length).toBeGreaterThan(0);
    for (const n of nums(card, (k) => `[data-count='${k}'] dd`)) expect(n).toMatch(/^\d+$/);
  });

  it("lists the regions beside the map in the map's order, each with a crest, a name and the card's numbers", () => {
    const rows = [...table.querySelectorAll("tbody tr[data-zone-row]")];
    expect(rows.map((r) => r.getAttribute("data-zone-row")).sort()).toEqual([...REGION_IDS].sort());
    const cards = [...home.querySelectorAll("#home-map .colorado-map__card")].map((c) => c.getAttribute("data-zone"));
    expect(rows.map((r) => r.getAttribute("data-zone-row")), "one fixed order for map and table").toEqual(cards);
    for (const row of rows) {
      const id = row.getAttribute("data-zone-row")!;
      expect(row.querySelector(`a[href='/regions/${id}/'] img[src='/art/brand/${id}-512-512.webp']`), id).not.toBeNull();
      const card = cardOf(id);
      expect(text(row.querySelector(".region-link__name"))).toBe(text(card.querySelector(".colorado-map__card-name")));
      const cells = nums(row, (k) => `td[data-count='${k}']`);
      for (const n of cells) expect(n).toMatch(/^\d+$/);
      expect(cells).toEqual(nums(card, (k) => `[data-count='${k}'] dd`));
    }
    expect([...table.querySelectorAll("thead th[scope='col']")].map((th) => text(th))).toEqual([
      "Region",
      "Leaderboard companies",
      "Events this week",
      "Startup Resources",
    ]);
  });

  it("uses no ranking words", () => {
    expect(text(table.closest("section"))).not.toMatch(/\b(?:top|best|leading|biggest|largest|ranked)\b/i);
  });

  it.each(REGION_IDS)("counts the same %s honorees and resources as its region page", (id) => {
    const page = parse(`regions/${id}/index.html`);
    const row = table.querySelector(`tr[data-zone-row='${id}']`)!;
    expect(text(row.querySelector("td[data-count='companies']"))).toBe(text(page.querySelector("[data-region-honorees] .tally__n")));
    expect(text(row.querySelector("td[data-count='resources']"))).toBe(text(page.querySelector("[data-region-resources] .tally__n")));
  });

  it.each(REGION_IDS)("counts the %s events of the next seven days as /data/events.json places them", (id) => {
    const asOf = Date.parse(table.getAttribute("data-as-of")!);
    const events = JSON.parse(readDist("data/events.json")) as (CalendarEvent & { region: string })[];
    const week = events.filter((e) => e.region === id && startsAt(e) < asOf + 7 * 86_400_000);
    expect(text(table.querySelector(`tr[data-zone-row='${id}'] td[data-count='events']`))).toBe(String(week.length));
  });
});
