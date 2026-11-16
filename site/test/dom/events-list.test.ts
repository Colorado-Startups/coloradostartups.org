// /event-calendar/ as it ships after step L2a: every upcoming event as a
// native list grouped by day, chips that filter it by region, this week and
// format without a page load and keep the choice in the URL, the Google
// Calendar behind a "Full calendar" disclosure that loads its frame only when
// opened, and the Ask your AI row. Run `npm run build` first (test:content does).
import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import {
  applyFilter,
  denverDay,
  filterQuery,
  initEventList,
  NEXT_7_DAYS,
  NO_FILTER,
  readFilter,
  startsWithinWeek,
  WEEK_MS,
  weekEnd,
} from "../../src/components/events/list-filter";
import { loadFrames, wireDeferredFrames } from "../../src/components/info/calendar-defer";
import { calendarEmbedUrl } from "../../src/components/info/links";
import { readDist } from "./pages";

const html = readDist("event-calendar/index.html");
const fresh = () => new DOMParser().parseFromString(html, "text/html");
const page = fresh();
const main = page.querySelector("main")!;
const list = main.querySelector<HTMLElement>("[data-event-list]")!;
const items = (root: Element) => [...root.querySelectorAll<HTMLElement>("li[data-ends]")];
const visible = (root: Element) => items(root).filter((li) => !li.hidden);
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// A clock just before the first listed event ends, so every built event is upcoming.
const firstEnd = Date.parse(items(list)[0]?.dataset.ends ?? "");
const NOW = firstEnd - 60_000;

describe("the events list", () => {
  it("sits after the next-events cards and before the full calendar", () => {
    const heading = page.getElementById("all-events")!;
    expect(heading.tagName).toBe("H2");
    expect(follows(page.getElementById("next-events")!, heading)).toBe(true);
    expect(follows(heading, page.getElementById("full-calendar")!)).toBe(true);
  });

  it("lists every event the cards were built from, hidden or not", () => {
    const cards = main.querySelectorAll(".next li.ev-card");
    expect(items(list).length).toBe(cards.length);
    expect(items(list).length).toBeGreaterThan(0);
  });

  it("groups events by Mountain Time day, soonest first, with the date as a heading", () => {
    const groups = [...list.querySelectorAll<HTMLElement>("[data-day-group]")];
    const days = groups.map((g) => g.querySelector("h3 time")?.getAttribute("datetime") ?? "");
    expect(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
    for (const group of groups) {
      const day = group.querySelector("h3 time")!.getAttribute("datetime");
      for (const li of items(group)) expect(li.dataset.day).toBe(day);
    }
  });

  it("gives each event a title, a time, an end instant, a format and a region the chips know", () => {
    const regions = new Set(["", "elsewhere", ...REGION_IDS]);
    for (const li of items(list)) {
      expect(text(li.querySelector(".ev__title"))).not.toBe("");
      expect(text(li.querySelector(".ev__time"))).not.toBe("");
      expect(Number.isNaN(Date.parse(li.dataset.ends ?? ""))).toBe(false);
      // L2b: the formats a row has, space-separated; "" when its place is not announced.
      expect(["in-person", "online", "in-person online", ""]).toContain(li.dataset.type);
      expect(regions.has(li.dataset.region ?? "missing")).toBe(true);
      if (li.dataset.type === "online") expect(li.dataset.region).toBe("");
      expect(li.querySelector(".ev__time time")?.getAttribute("datetime")).toBeTruthy();
    }
  });

  // The tie on start time is pinned with fixed events in test/unit/events-format.test.ts.
  it("orders the events within one day by start time, then title", () => {
    for (const group of list.querySelectorAll<HTMLElement>("[data-day-group]")) {
      const rows = items(group).map((li) => ({
        start: Date.parse(li.querySelector(".ev__time time")!.getAttribute("datetime")!),
        title: text(li.querySelector(".ev__title")),
      }));
      const sorted = [...rows].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
      expect(rows).toEqual(sorted);
    }
  });

  it("opens event links off the site without passing rank", () => {
    for (const a of list.querySelectorAll(".ev__title a")) {
      expect(a.getAttribute("href")).toMatch(/^https?:\/\//);
      expect(a.getAttribute("rel")).toBe("nofollow noopener");
    }
  });
});

describe("the filter chips", () => {
  const form = list.querySelector<HTMLFormElement>("[data-list-filters]")!;
  const group = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];

  it("are radio groups with a legend, each starting on its All choice", () => {
    for (const fieldset of form.querySelectorAll("fieldset")) {
      expect(text(fieldset.querySelector("legend"))).not.toBe("");
      const radios = [...fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.length).toBeGreaterThan(1);
      expect(radios.filter((r) => r.hasAttribute("checked")).map((r) => r.value)).toEqual([""]);
    }
  });

  it("offer This week and Next 7 days, every region, and Elsewhere or a format only when the data has it", () => {
    expect(group("when").map((r) => r.value)).toEqual(["", "week", NEXT_7_DAYS]);
    expect(text(group("when")[2]!.closest("label"))).toBe("Next 7 days");
    // Step R1: each region page links its events count here, so every region has a chip.
    const inData = new Set(items(list).map((li) => li.dataset.region).filter(Boolean));
    expect(group("region").map((r) => r.value)).toEqual(["", ...REGION_IDS, ...(inData.has("elsewhere") ? ["elsewhere"] : [])]);
    const types = new Set(items(list).flatMap((li) => (li.dataset.type ?? "").split(" ").filter(Boolean)));
    expect(group("type").length > 0).toBe(types.size > 1);
  });

  it("are hidden without JavaScript, so the full list stands alone", () => {
    expect(text(list.querySelector("noscript"))).toMatch(/\[data-list-filters\][^}]*display:\s*none/);
  });

  it("report the count in a polite live region", () => {
    const status = list.querySelector("[data-list-count]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(text(status)).toBe(`Showing all ${items(list).length} upcoming events.`);
  });
});

describe("filtering the built list", () => {
  it("by region shows only that region's events", () => {
    const region = items(list).find((li) => li.dataset.region)?.dataset.region;
    if (!region) return;
    const root = fresh().querySelector("[data-event-list]")!;
    const { shown } = applyFilter(root, { ...NO_FILTER, region }, NOW);
    expect(shown).toBe(items(list).filter((li) => li.dataset.region === region).length);
    expect(visible(root).every((li) => li.dataset.region === region)).toBe(true);
  });

  it("by format shows only online events, and hides days left empty", () => {
    const root = fresh().querySelector("[data-event-list]")!;
    applyFilter(root, { ...NO_FILTER, type: "online" }, NOW);
    expect(visible(root).every((li) => li.dataset.type!.split(" ").includes("online"))).toBe(true);
    for (const g of root.querySelectorAll<HTMLElement>("[data-day-group]")) {
      expect(g.hidden).toBe(visible(g).length === 0);
    }
  });

  it("by this week keeps events that start by Sunday, Mountain Time", () => {
    const root = fresh().querySelector("[data-event-list]")!;
    applyFilter(root, { ...NO_FILTER, when: "week" }, NOW);
    const last = weekEnd(denverDay(NOW));
    expect(visible(root).length).toBeGreaterThan(0);
    expect(visible(root).every((li) => (li.dataset.day ?? "") <= last)).toBe(true);
    expect(items(root).filter((li) => li.hidden).every((li) => (li.dataset.day ?? "") > last)).toBe(true);
  });

  it("by next 7 days keeps events that start within seven days of now, and leaves This week as it was", () => {
    const root = fresh().querySelector("[data-event-list]")!;
    applyFilter(root, { ...NO_FILTER, when: NEXT_7_DAYS }, NOW);
    expect(visible(root).length).toBeGreaterThan(0);
    for (const li of items(root)) {
      const starts = Date.parse(li.dataset.starts!);
      expect(Number.isNaN(starts), "every row carries its start").toBe(false);
      expect(!li.hidden, li.dataset.starts).toBe(starts < NOW + WEEK_MS);
    }
    // The rule is strict at the edge, as zone-counts.ts counts.
    expect(startsWithinWeek(NOW + WEEK_MS - 1, NOW)).toBe(true);
    expect(startsWithinWeek(NOW + WEEK_MS, NOW)).toBe(false);
    // This week still ends on Sunday.
    const week = fresh().querySelector("[data-event-list]")!;
    applyFilter(week, { ...NO_FILTER, when: "week" }, NOW);
    expect(visible(week).every((li) => (li.dataset.day ?? "") <= weekEnd(denverDay(NOW)))).toBe(true);
  });

  it("drops events that have ended, and says so when none are left", () => {
    const root = fresh().querySelector("[data-event-list]")!;
    const later = Math.max(...items(root).map((li) => Date.parse(li.dataset.ends!))) + 1;
    expect(applyFilter(root, NO_FILTER, later)).toEqual({ shown: 0, upcoming: 0 });
    expect(root.querySelector<HTMLElement>("[data-events-empty]")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("[data-list-none]")!.hidden).toBe(true);
  });

  it("links the empty message to the full calendar disclosure", () => {
    const link = list.querySelector("[data-events-empty] a")!;
    expect(link.getAttribute("href")).toBe("#full-calendar");
    expect(page.getElementById("full-calendar")).not.toBeNull();
    expect(page.querySelector("details[data-full-calendar]")!.getAttribute("data-open-on")).toBe("full-calendar");
  });

  it("offers a way back when the filters match nothing", () => {
    const root = fresh().querySelector("[data-event-list]")!;
    applyFilter(root, { ...NO_FILTER, region: "no-such-region" }, NOW);
    const none = root.querySelector<HTMLElement>("[data-list-none]")!;
    expect(none.hidden).toBe(false);
    expect(text(none.querySelector("button[data-list-clear]"))).toBe("Show every event");
  });
});

describe("the filter in the URL", () => {
  it("round-trips and leaves the plain URL plain", () => {
    expect(filterQuery(NO_FILTER)).toBe("");
    const filter = { region: "space-peak", when: "week", type: "in-person" };
    expect(readFilter(filterQuery(filter))).toEqual(filter);
  });

  it("is read on load and written back on change, keeping the hash", () => {
    document.body.innerHTML = list.outerHTML;
    const root = document.querySelector<HTMLElement>("[data-event-list]")!;
    window.history.replaceState(null, "", "/event-calendar/?type=online#all-events");
    initEventList(root, () => NOW);
    const checked = (name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
    expect(checked("type")).toBe("online");
    expect(visible(root).every((li) => li.dataset.type!.split(" ").includes("online"))).toBe(true);

    const week = root.querySelector<HTMLInputElement>('input[name="when"][value="week"]')!;
    week.checked = true;
    week.dispatchEvent(new Event("change", { bubbles: true }));
    expect(window.location.search).toBe("?when=week&type=online");
    expect(window.location.hash).toBe("#all-events");
  });
});

describe("the full calendar disclosure", () => {
  const details = main.querySelector<HTMLDetailsElement>("details[data-full-calendar]")!;
  const frame = details.querySelector("iframe")!;

  it("is closed, says it opens Google's calendar from Google, under the full-calendar heading", () => {
    expect(details.hasAttribute("open")).toBe(false);
    expect(text(details.querySelector("summary"))).toBe("Show Google's calendar (it loads from Google when you open it)");
    expect(follows(page.getElementById("full-calendar")!, details)).toBe(true);
  });

  it("holds Google's frame with no src, so it loads only when opened", () => {
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("data-src")).toBe(calendarEmbedUrl());
    expect(frame.getAttribute("title")).toMatch(/calendar/i);
  });

  it("sets the frame's src on opening", () => {
    const copy = fresh().querySelector("details[data-full-calendar]")!;
    expect(loadFrames(copy)).toBe(1);
    expect(copy.querySelector("iframe")!.getAttribute("src")).toBe(calendarEmbedUrl());
    expect(loadFrames(copy)).toBe(0);
  });

  // L2b: the toggle itself, wired as the page wires it (calendar-defer.ts).
  it("has no src until the disclosure opens, then loads Google's frame once", () => {
    window.history.replaceState(null, "", "/event-calendar/");
    document.body.innerHTML = details.outerHTML;
    const live = document.querySelector<HTMLDetailsElement>("details[data-full-calendar]")!;
    const liveFrame = live.querySelector("iframe")!;
    wireDeferredFrames(document);
    expect(liveFrame.hasAttribute("src")).toBe(false);
    live.open = true;
    live.dispatchEvent(new Event("toggle"));
    expect(liveFrame.getAttribute("src")).toBe(calendarEmbedUrl());
    live.open = false;
    live.dispatchEvent(new Event("toggle"));
    expect(liveFrame.getAttribute("src")).toBe(calendarEmbedUrl());
  });

  it("opens itself on a link to #full-calendar", () => {
    window.history.replaceState(null, "", "/event-calendar/#full-calendar");
    document.body.innerHTML = details.outerHTML;
    const live = document.querySelector<HTMLDetailsElement>("details[data-full-calendar]")!;
    wireDeferredFrames(document);
    expect(live.open).toBe(true);
    live.dispatchEvent(new Event("toggle"));
    expect(live.querySelector("iframe")!.getAttribute("src")).toBe(calendarEmbedUrl());
    window.history.replaceState(null, "", "/event-calendar/");
  });
});

describe("the rest of the page", () => {
  it("has the Ask your AI row after the calendar", () => {
    const ask = main.querySelector("[data-ask-ai]")!;
    expect(ask).not.toBeNull();
    expect(follows(main.querySelector("details[data-full-calendar]")!, ask)).toBe(true);
  });

  it("keeps one Event JSON-LD block", () => {
    const blocks = page.querySelectorAll('script[type="application/ld+json"]');
    const events = [...blocks].filter((b) => (b.textContent ?? "").includes('"Event"'));
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it("ships no inline executable script from the list", () => {
    for (const s of list.querySelectorAll("script")) expect(s.hasAttribute("src")).toBe(true);
  });
});

describe("week and day helpers", () => {
  it("end the week on Sunday", () => {
    expect(weekEnd("2026-11-16")).toBe("2026-11-22");
    expect(weekEnd("2026-11-22")).toBe("2026-11-22");
    expect(weekEnd("2026-12-31")).toBe("2027-01-03");
  });

  it("read the day in Mountain Time", () => {
    expect(denverDay(Date.parse("2026-11-17T05:00:00Z"))).toBe("2026-11-16");
    expect(denverDay(Date.parse("2026-11-17T07:00:00Z"))).toBe("2026-11-17");
  });
});
