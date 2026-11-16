// L8 over the built site (run `npm run build` first; test:content does):
// /regions/ shows the three zones on the live map, with chips and the theme
// panels; each region page leads with the map zoomed to it and what is there
// (step R1), then four sourced figures, This week with the region's next
// events and the weekly threads (step P2b), its Connector seat, six resources
// and six honorees that really belong to it, each with a "see all" link, and
// its painting as an extra further down; Fusion Canyon's copy rule holds; and
// MapLibre stays out of every page's entry JavaScript.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { REGION_IDS, regionLede, WAYS_IN } from "@cs/shared";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { type CalendarEvent, endsAt, startsAt } from "../../../src/components/events/events";
import { applyFilter, NEXT_7_DAYS, readFilter } from "../../../src/components/events/list-filter";
import { refreshBand } from "../../../src/components/events/this-week";
import { CALENDAR_TIMEZONE } from "../../../src/components/info/links";
import { SLACK_JOIN } from "../../../src/lib/communitas/join";
import { regionForCity, REGIONS } from "../../../src/lib/regions/match";
import { summaryAfterLede } from "../../../src/lib/regions/page";
import { INSIDE_A_CANYON } from "../../unit/l8/canyon-rule";
import { DIST_DIR, readDist, SITE_DIR } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const index = doc(readDist("regions/index.html"));
const pages = Object.fromEntries(REGION_IDS.map((id) => [id, doc(readDist(`regions/${id}/index.html`))]));
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
// SHOWN in src/components/regions/RegionResources.astro and RegionHonorees.astro.
const SHOWN = 6;

const positions = parse(readFileSync(path.resolve(SITE_DIR, "..", "data", "team", "positions.yaml"), "utf8")) as {
  id: string;
  region?: string;
  title: string;
  status: string;
  apply?: { open?: boolean };
}[];
const threads = parse(readFileSync(path.resolve(SITE_DIR, "..", "data", "communitas", "threads.yaml"), "utf8")) as {
  day: string;
  title: string;
}[];
/** The events /data/events.json lists, each with the region placeRegion() gives it. */
const openEvents = () => JSON.parse(readDist("data/events.json")) as (CalendarEvent & { region: string })[];
// COUNT in src/components/events/ThisWeek.astro.
const THIS_WEEK = 3;

// Words as test/dom/home/this-week.test.ts counts them: text nodes joined with a space.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
function words(root: Element): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE) parts.push(child.textContent ?? "");
      else if (child.nodeType === child.ELEMENT_NODE && !(child as Element).matches("script, style, svg, [hidden], .visually-hidden"))
        walk(child);
    }
  };
  walk(root);
  return parts.join(" ").match(WORD) ?? [];
}

describe("/regions/", () => {
  it("shows the three zones on one live map, with the drawing as its no-JavaScript layer", () => {
    const fig = index.querySelector<HTMLElement>("figure#regions-map");
    expect(fig?.hasAttribute("data-colorado-map"), "marked for the live map").toBe(true);
    expect(fig?.dataset.zone, "the whole state, not one zone").toBeUndefined();
    const svg = fig?.querySelector(".colorado-map__drawing svg");
    expect(svg?.getAttribute("role")).toBe("img");
    for (const r of REGIONS) expect(text(fig?.querySelector(".colorado-map__drawing")), r.id).toContain(r.name);
    expect(text(fig?.querySelector("figcaption"))).toMatch(/proposal, not a legal line/);
  });

  it("lists the three regions in order beside the map, each linking to its page with its cities and seat", () => {
    const chips = [...index.querySelectorAll<HTMLElement>(".region-chips [data-region]")];
    expect(chips.map((c) => c.dataset.region)).toEqual(REGIONS.map((r) => r.id));
    for (const [i, r] of REGIONS.entries()) {
      const chip = chips[i]!;
      expect(chip.querySelector("a")?.getAttribute("href")).toBe(`/regions/${r.id}/`);
      for (const city of r.cities) expect(text(chip)).toContain(city);
      expect(text(chip)).toMatch(/Connector/);
    }
  });

  it("shows the three theme panels, every figure with its source line", () => {
    const panels = [...index.querySelectorAll(".theme")];
    expect(panels).toHaveLength(3);
    for (const panel of panels) {
      const stats = [...panel.querySelectorAll(".stat")];
      expect(stats.length).toBeGreaterThan(0);
      for (const s of stats) expect(text(s.querySelector(".stat__source")).length, text(s)).toBeGreaterThan(0);
    }
    const hrefs = panels.map((p) => p.querySelector("a[href^='/regions/']")?.getAttribute("href"));
    expect(hrefs.sort()).toEqual(REGIONS.map((r) => `/regions/${r.id}/`).sort());
  });

  it("says a person holds each Connector seat, never an AI keeper", () => {
    const how = text(index.getElementById("how-title")?.parentElement);
    expect(how).toContain("1 Connector per region. A person, never an AI keeper.");
  });

  it("has a line for founders elsewhere in Colorado", () => {
    const section = index.getElementById("elsewhere")?.parentElement;
    expect(text(section)).toMatch(/anywhere else in Colorado\? You are part of this community too\./);
  });
});

describe.each(REGIONS.map((r) => [r.id, r] as const))("/regions/%s/", (id, region) => {
  const page = pages[id]!;

  it("has the region's name, lede, map and four sourced figures, and no painting, in its first section", () => {
    expect(text(page.querySelector("h1"))).toBe(region.name);
    const intro = page.querySelector("section");
    expect(text(intro)).toContain(regionLede(region));
    expect(intro?.querySelector("figure#region-map")).not.toBeNull();
    expect(intro?.querySelector(".region-art, video"), "the painting is an extra, further down").toBeNull();
    const stats = [...(intro?.querySelectorAll("[data-region-tiles] .stat") ?? [])];
    expect(stats).toHaveLength(4);
    for (const s of stats) expect(text(s.querySelector(".stat__source")).length, text(s)).toBeGreaterThan(0);
  });

  // #67: the brand bans a hub word on a place (decision 58).
  it("is titled with the region name alone, with no hub word", () => {
    const title = text(page.querySelector("title"));
    expect(title).toBe(`${region.name} | Colorado Startups`);
    expect(page.querySelector("meta[property='og:title']")?.getAttribute("content")).toBe(title);
    expect(title).not.toMatch(/\b(?:Outpost|HQ|Hall)\b/i);
  });

  // Step R0 split the page into sections/; the outline is the one the page
  // had before the split, plus the slots as they fill (A3a: Ask your AI). Step
  // R1 put "What's here" beside the map in the first section, and moved the
  // painting after the honorees and the Slack, before Ask your AI. Step P2b
  // filled the This week slot, and took the next event out of What's here.
  it("has one h1, and its headings in order", () => {
    const position = positions.find((p) => p.region === id)!;
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    const outline = [...page.querySelectorAll("main h1, main h2")].map((h) => `${h.tagName} ${text(h)}`);
    expect(outline).toEqual([
      `H1 ${region.name}`,
      "H2 What's here",
      `H2 ${region.name} in numbers`,
      "H2 This week",
      expect.stringMatching(/^H2 (?:Your|The) /),
      "H2 Startup Resources",
      "H2 Leaderboard honorees",
      "H2 Meet founders here",
      `H2 ${region.name} as a painting`,
      "H2 Ask your AI about this page",
      "H2 The other regions",
    ]);
    expect(outline[4], "the seat heading names the seat").toContain(position.title);
    // No level is skipped: each heading is at most one level below the one before.
    const levels = [...page.querySelectorAll("main h1, main h2, main h3, main h4")].map((h) => Number(h.tagName[1]));
    for (const [i, n] of levels.entries()) if (i > 0) expect(n, `heading ${i + 1}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
    const here = [...(page.getElementById("where")?.parentElement?.querySelectorAll("h3") ?? [])].map(text);
    expect(here).toEqual([
      "Core cities",
      ...(position.status === "open" ? ["Open seat"] : []),
      ...(region.nearby.length > 0 ? ["Nearby towns"] : []),
      "Size",
    ]);
    expect(page.querySelector("h1")?.closest("section")?.querySelector("figure#region-map")).not.toBeNull();
  });

  // Paul, 2026-11-16: "It should be the map and what's there."
  it("shows the map as the first image in main, its relief loaded eagerly at high priority", () => {
    const main = page.querySelector("main")!;
    const first = main.querySelector("img, picture, video, svg[role='img']");
    expect(first?.closest("figure#region-map"), "the first image is the map").not.toBeNull();
    const relief = main.querySelector<HTMLImageElement>("figure#region-map img.colorado-map__relief")!;
    expect(relief.getAttribute("loading")).toBe("eager");
    expect(relief.getAttribute("fetchpriority")).toBe("high");
    expect(Number(relief.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(relief.getAttribute("height"))).toBeGreaterThan(0);
    // The drawing is in the HTML, so the map paints without waiting on script.
    expect(main.querySelector("figure#region-map .colorado-map__drawing svg[role='img']")).not.toBeNull();
  });

  it("puts the painting in its own section after the honorees, with a plain heading, loaded lazily", () => {
    const sections = [...page.querySelectorAll("main section")];
    const at = (sel: string) => sections.findIndex((s) => s.querySelector(sel));
    const painting = at(".region-art--hero");
    expect(painting).toBeGreaterThan(at("[data-region-honorees]"));
    expect(painting).toBeLessThan(at("#ask-ai"));
    const section = sections[painting]!;
    expect(section.getAttribute("aria-labelledby")).toBe("painting");
    expect(text(section.querySelector("#painting"))).toBe(`${region.name} as a painting`);
    expect(text(section)).toMatch(/fantasy Colorado/);
    const img = section.querySelector(".region-art--hero img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("fetchpriority")).not.toBe("high");
    // The clip fetches nothing until it plays, and it plays only on screen (RegionArt.astro).
    const videos = [...page.querySelectorAll("video")];
    expect(videos.length).toBeGreaterThan(0);
    for (const video of videos) {
      expect(video.closest("section"), "every video sits in the painting's section").toBe(section);
      expect(video.getAttribute("preload")).toBe("none");
      expect(video.hasAttribute("autoplay")).toBe(false);
      expect(video.hasAttribute("poster")).toBe(false);
      expect(video.hasAttribute("src")).toBe(false);
    }
  });

  it("shows what is here beside the map: its three counts, each linked and dated, as the home map counts them", () => {
    const here = page.getElementById("where")!.parentElement!;
    expect(here.closest("section")).toBe(page.querySelector("main section"));
    const list = here.querySelector<HTMLElement>("[data-region-counts]")!;
    const items = [...list.querySelectorAll<HTMLElement>("li[data-count]")];
    expect(items.map((li) => li.dataset.count)).toEqual(["companies", "events", "resources"]);
    const n = (key: string) => text(list.querySelector(`li[data-count='${key}'] .here__n`));
    for (const li of items) {
      expect(n(li.dataset.count!), li.dataset.count).toMatch(/^\d+$/);
      expect(li.querySelector("a[href] .here__n"), "the number is a link").not.toBeNull();
      expect(text(li.querySelector(".here__as-of")), li.dataset.count).toMatch(/^As of \w{3} \d{1,2}, \d{4}$/);
      expect(li.querySelector(".here__as-of time")?.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(list.querySelector("li[data-count='companies'] a")?.getAttribute("href")).toBe(`/leaderboard/?region=${id}`);
    expect(list.querySelector("li[data-count='events'] a")?.getAttribute("href")).toBe(
      `${WAYS_IN.events}?region=${id}&when=${NEXT_7_DAYS}#all-events`,
    );
    expect(list.querySelector("li[data-count='resources'] a")?.getAttribute("href")).toBe(`/ecosystem-canvas/?region=${id}`);
    // The same numbers the page's own lists tally, and the home map's table.
    expect(n("companies")).toBe(text(page.querySelector("[data-region-honorees] .tally__n")));
    expect(n("resources")).toBe(text(page.querySelector("[data-region-resources] .tally__n")));
    const home = doc(readDist("index.html")).querySelector(`table[data-zone-counts] tr[data-zone-row='${id}']`)!;
    for (const key of ["companies", "events", "resources"]) expect(n(key), key).toBe(text(home.querySelector(`td[data-count='${key}']`)));
    // Events: the next seven days from the build, as /data/events.json places them.
    const asOf = Date.parse(list.dataset.asOf!);
    const events = JSON.parse(readDist("data/events.json")) as (CalendarEvent & { region: string })[];
    expect(n("events")).toBe(String(events.filter((e) => e.region === id && startsAt(e) < asOf + 7 * 86_400_000).length));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIMEZONE }).format(new Date(asOf));
    expect(list.querySelector("li[data-count='events'] time")?.getAttribute("datetime")).toBe(day);
    // Regions are equals.
    expect(text(here)).not.toMatch(/\b(?:top|best|leading|biggest|largest|ranked)\b/i);
  });

  // Review of #115: the events count's link lands on a list that shows the same
  // number. The list filters on the visitor's clock; held at the count's own
  // build instant (data-as-of), it must show exactly the count.
  it("links the events count to a list that shows the same number at the count's instant", () => {
    const list = page.querySelector<HTMLElement>("[data-region-counts]")!;
    const asOf = Date.parse(list.dataset.asOf!);
    const href = list.querySelector("li[data-count='events'] a")!.getAttribute("href")!;
    const filter = readFilter(new URL(href, "https://coloradostartups.org").search);
    expect(filter).toEqual({ region: id, when: NEXT_7_DAYS, type: "" });
    const calendar = doc(readDist("event-calendar/index.html")).querySelector("[data-event-list]")!;
    // The region has a chip on the list even with no event, so the link never falls back to every region.
    expect(calendar.querySelector(`input[name='region'][value='${id}']`)).not.toBeNull();
    expect(calendar.querySelector(`input[name='when'][value='${NEXT_7_DAYS}']`)).not.toBeNull();
    const { shown } = applyFilter(calendar, filter, asOf);
    expect(String(shown)).toBe(text(list.querySelector("li[data-count='events'] .here__n")));
  });

  // Step P2b: This week, right below, carries the next events, so What's here
  // names none (the page shows each event once).
  it("leaves the next event to This week, and names the seat only while it is open", () => {
    const here = page.getElementById("where")!.parentElement!;
    expect(here.querySelector("[data-region-next], [data-this-week]")).toBeNull();
    const position = positions.find((p) => p.region === id)!;
    const seat = here.querySelector("a[data-open-seat]");
    if (position.status === "open") expect(text(seat)).toBe(position.title);
    else expect(seat).toBeNull();
  });

  // Step P2b: home's This week strip (components/events/ThisWeek.astro), with
  // only the events placed in this region, the same weekly threads and the one
  // Slack join link.
  describe("This week", () => {
    const band = page.querySelector<HTMLElement>('section[aria-labelledby="this-week"]')!;
    const list = () => band.querySelector<HTMLElement>("[data-this-week]")!;
    const items = () => [...list().querySelectorAll<HTMLElement>("li[data-ends]")];
    const shown = () => items().filter((li) => !li.hidden);
    const asOf = () => Date.parse(page.querySelector<HTMLElement>("[data-region-counts]")!.dataset.asOf!);
    /** The events placed here that had not ended at the build, soonest first. */
    const placedHere = () => openEvents().filter((e) => e.region === id && endsAt(e) > asOf());
    const listHref = `${WAYS_IN.events}?region=${id}#all-events`;

    it("is the section right after the first one, headed This week", () => {
      expect(band).not.toBeNull();
      expect(text(band.querySelector("h2#this-week"))).toBe("This week");
      const sections = [...page.querySelectorAll("main section")];
      expect(sections.indexOf(band)).toBe(sections.indexOf(page.querySelector("h1")!.closest("section")!) + 1);
    });

    it("lists only the events placed here, at most three, soonest first, as /data/events.json places them", () => {
      const expected = placedHere();
      expect(shown()).toHaveLength(Math.min(THIS_WEEK, expected.length));
      expect(shown(), "the first ones show; the rest wait for prune.ts").toEqual(items().slice(0, shown().length));
      const starts = items().map((li) => Date.parse(li.dataset.starts!));
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      for (const [i, li] of items().entries()) {
        const e = expected[i]!;
        expect(li.dataset.eventRegion, e.title).toBe(id);
        expect(Date.parse(li.dataset.ends!), "not ended at build").toBeGreaterThan(asOf());
        expect(li.querySelector("time[data-countdown]")?.getAttribute("datetime")).toBe(e.start);
        expect(text(li.querySelector("time")), e.title).toMatch(/^(on now|today|tomorrow|in \d+ days)$/);
        // A cut title keeps its full text for assistive tech, with the date.
        const link = li.querySelector("a")!;
        const label = link.getAttribute("aria-label") ?? "";
        expect(label.startsWith(`${e.title}, `), label).toBe(true);
        expect(label.startsWith(text(link).replace(/…$/, ""))).toBe(true);
        expect(link.getAttribute("href"), "a title opens the region's event list").toBe(listHref);
      }
    });

    it("links on to the region's event list when fewer than three show, and says none in one plain line", () => {
      const n = shown().length;
      const empty = list().querySelector<HTMLElement>("[data-events-empty]")!;
      const more = list().querySelector<HTMLElement>("[data-events-more]")!;
      expect(empty.hidden).toBe(n > 0);
      expect(text(empty)).toBe("No events listed here yet.");
      expect(empty.querySelector("a"), "a plain line, the link is its own").toBeNull();
      expect(more.hidden).toBe(n >= THIS_WEEK);
      const link = more.querySelector("a")!;
      expect(text(link)).toBe(`Events in ${region.name}`);
      expect(link.getAttribute("href")).toBe(listHref);
      expect(readFilter(new URL(listHref, "https://coloradostartups.org").search)).toEqual({ region: id, when: "", type: "" });
      const calendar = doc(readDist("event-calendar/index.html"));
      expect(calendar.querySelector(`[data-event-list] input[name='region'][value='${id}']`), "the list has this region's chip").not.toBeNull();
      expect(calendar.getElementById("all-events")).not.toBeNull();
    });

    it("drops past events on the visitor's clock, then offers the region's list", () => {
      const root = list().cloneNode(true) as HTMLElement;
      const all = [...root.querySelectorAll<HTMLElement>("li[data-ends]")];
      if (all.length > 0) {
        const at = Date.parse(all[0]!.dataset.ends!);
        refreshBand(root, at);
        expect(all[0]!.hidden, "the first event has ended").toBe(true);
        const left = all.filter((li) => Date.parse(li.dataset.ends!) > at);
        expect(all.filter((li) => !li.hidden)).toEqual(left.slice(0, THIS_WEEK));
      }
      expect(refreshBand(root, Number.MAX_SAFE_INTEGER)).toBe(0);
      expect(root.querySelector<HTMLElement>("[data-events-empty]")!.hidden).toBe(false);
      expect(root.querySelector<HTMLElement>("[data-events-more]")!.hidden).toBe(false);
    });

    it("shows home's weekly threads, Monday, Wednesday and Friday", () => {
      const rows = [...band.querySelectorAll<HTMLElement>("[data-threads] li[data-day]")];
      expect(rows.map((r) => r.dataset.day)).toEqual(["mon", "wed", "fri"]);
      for (const r of rows) expect(text(r)).toContain(threads.find((t) => t.day === r.dataset.day)!.title);
      const home = doc(readDist("index.html")).querySelectorAll('section[aria-labelledby="this-week"] [data-threads] li[data-day]');
      expect(rows.map(text)).toEqual([...home].map(text));
    });

    it("has one Slack link, the page's one join link, described by the hero's note", () => {
      const slack = [...band.querySelectorAll("a")].filter((a) => a.getAttribute("href") === SLACK_JOIN.href);
      expect(slack).toHaveLength(1);
      expect(slack[0]!.dataset.link).toBe("slack");
      const note = page.getElementById(slack[0]!.getAttribute("aria-describedby") ?? "");
      expect(text(note)).toBe(SLACK_JOIN.note);
      expect(note?.closest("section"), "the note is the first screen's").toBe(page.querySelector("main section"));
      // One way in: every on-site Slack link on the page goes to the same place.
      const slackLinks = [...page.querySelectorAll("main a[href^='/']")].filter((a) => /slack/i.test(a.getAttribute("href")!));
      expect(new Set(slackLinks.map((a) => a.getAttribute("href")))).toEqual(new Set([SLACK_JOIN.href]));
      expect(band.querySelector(`a[data-link="linkedin-group"]`)?.getAttribute("href")).toBe(WAYS_IN["linkedin-group"]);
    });

    it("shows no event twice on the page", () => {
      const keys = shown().map((li) => `${li.dataset.starts} ${li.querySelector("a")!.getAttribute("aria-label")}`);
      expect(new Set(keys).size).toBe(keys.length);
      // What a visitor sees outside the band: no hidden queue, closed popover or closed details.
      const rest = page.querySelector("main")!.cloneNode(true) as HTMLElement;
      rest.querySelector('section[aria-labelledby="this-week"]')!.remove();
      for (const el of rest.querySelectorAll("[hidden], [popover], script, style, template")) el.remove();
      for (const d of rest.querySelectorAll("details:not([open])")) for (const c of [...d.children]) if (c.tagName !== "SUMMARY") c.remove();
      for (const e of placedHere().slice(0, shown().length)) expect(text(rest), e.title).not.toContain(e.title);
    });

    it("stays short: about 50 visible words besides the event titles, in the site's words", () => {
      const all = words(band).length;
      const titles = shown().reduce((n, li) => n + words(li.querySelector("a")!).length, 0);
      console.info(`regions/${id}/: ${all} visible words in This week, ${titles} of them event titles`);
      expect(all - titles).toBeGreaterThan(0);
      expect(all - titles).toBeLessThanOrEqual(50);
      expect(text(band)).not.toMatch(/\b\d[\d,.]*\s*\+?\s*(members|startupers|founders|people|attendees|going)\b/i);
      expect(text(band)).not.toMatch(/—| – |\bOutpost\b|\bHQ\b|\bHall\b/);
    });

    it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
      const results = await axe.run(band, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  });

  it("zooms the map to the region, names its core cities, and lists its towns", () => {
    const fig = page.querySelector<HTMLElement>("figure#region-map");
    expect(fig?.dataset.zone).toBe(id);
    expect(fig?.hasAttribute("data-colorado-map"), "marked for the live map").toBe(true);
    const drawing = text(fig?.querySelector(".colorado-map__drawing"));
    for (const city of region.cities) expect(drawing).toContain(city);
    expect(text(fig?.querySelector("figcaption"))).toContain(summaryAfterLede(region).replace(/\s+/g, " "));
    const where = text(page.getElementById("where")?.closest("section"));
    for (const town of [...region.cities, ...region.nearby]) expect(where).toContain(town);
  });

  // The seat is L9's PositionCard inside L8's thin wrapper (L15), the same
  // card /get-involved/ shows.
  it("shows the organizer seat from positions.yaml", () => {
    const position = positions.find((p) => p.region === id)!;
    const seat = page.querySelector<HTMLElement>(".organizer");
    expect(seat?.dataset.seat).toBe(position.status);
    const card = seat?.querySelector<HTMLElement>(`article[data-position='${position.id}']`);
    expect(card?.dataset.status).toBe(position.status);
    expect(text(card?.querySelector("h3"))).toBe(position.title);
    expect(card?.querySelector(`a[href='/regions/${id}/']`), "no link to the page it sits on").toBeNull();
    expect(text(seat)).toMatch(/keepers are AI agents, and they never take this seat/);
    if (position.status === "open" && position.apply?.open) {
      expect(text(card)).toContain("Open seat");
      expect(card?.querySelector("a[data-apply]")?.getAttribute("href")).toBe(`/get-involved/apply/?role=${position.id}`);
    }
  });

  it("shows six of its Startup Resources at most, each based in the region, and links to all of them", () => {
    const section = page.querySelector("[data-region-resources]")!;
    const items = [...section.querySelectorAll<HTMLElement>("li[data-city]")];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(SHOWN);
    for (const li of items) expect(regionForCity(li.dataset.city!), li.dataset.id).toBe(id);
    // The tally is the whole region: the sum of its city counts.
    const tally = Number(text(section.querySelector(".tally__n")));
    const cityCounts = [...section.querySelectorAll(".city-links a:not([data-statewide]) .count")].map((c) => Number(text(c)));
    expect(cityCounts.reduce((a, b) => a + b, 0)).toBe(tally);
    expect(items).toHaveLength(Math.min(SHOWN, tally));
    const all = section.querySelector("a[data-see-all]");
    expect(all?.getAttribute("href")).toBe(`/ecosystem-canvas/?region=${id}`);
    expect(text(all)).toBe(`See all ${tally} in ${region.name}`);
  });

  it("links each of its cities into the directory's city filter", () => {
    const links = [...page.querySelectorAll<HTMLAnchorElement>("[data-region-resources] .city-links a:not([data-statewide])")];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const city = new URLSearchParams(a.getAttribute("href")!.split("?")[1]).get("city")!;
      expect(regionForCity(city)).toBe(id);
    }
  });

  it("shows six of its honorees at most, each headquartered here, with no investing language, and links to all", () => {
    const section = page.querySelector("[data-region-honorees]")!;
    const items = [...section.querySelectorAll<HTMLElement>("li[data-hq]")];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(regionForCity(li.dataset.hq!), li.dataset.id).toBe(id);
    const tally = Number(text(section.querySelector(".tally__n")));
    expect(items).toHaveLength(Math.min(SHOWN, tally));
    const all = section.querySelector("a[data-see-all]");
    expect(all?.getAttribute("href")).toBe(`/leaderboard/?region=${id}`);
    expect(text(all)).toBe(`See all ${tally} honorees`);
    // Decision 17 and the Leaderboard purpose limit.
    expect(text(section)).not.toMatch(/\binvest|\bfund(?:s|ing|raise)?\b|\bseries [a-z]\b|\bdeal flow\b/i);
  });

  it("points to the Slack and the event calendar", () => {
    const meet = page.getElementById("meet")?.parentElement;
    const hrefs = [...(meet?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining([WAYS_IN.slack, WAYS_IN.events]));
  });

  it("shows the other two regions as their /regions/ chips", () => {
    const others = REGIONS.filter((r) => r.id !== id);
    const chips = [...page.querySelectorAll(".others [data-region]")];
    expect(chips.map((c) => c.getAttribute("data-region"))).toEqual(others.map((r) => r.id));
    for (const [i, chip] of chips.entries()) {
      expect(text(chip)).toBe(text(index.querySelector(`.region-chips [data-region='${others[i]!.id}']`)));
    }
  });
});

describe("Fusion Canyon on the page", () => {
  const body = text(pages["fusion-canyon"]!.querySelector("main"));

  it("is named for the canyon and built on the plain, never inside it", () => {
    expect(body).toMatch(/named for the canyon and built on the plain/i);
    expect(body).not.toMatch(INSIDE_A_CANYON);
  });
});

// PLAN.md, Gates: a JS budget of 75 KB gzipped or less on content pages
// (goal). A page with a live map ships MapLibre (about 250 KB compressed), so
// MapLibre must load only by dynamic import, when a map nears the screen: the
// budget counts what a page loads up front, its entry scripts and every file
// they import statically. The dynamic part is measured and logged, not
// budgeted: CI's log carries both numbers.
const local = (from: string, spec: string) =>
  spec.startsWith("/") ? path.join(DIST_DIR, spec.replace(/^\//, "")) : path.resolve(path.dirname(from), spec);
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']((?:\.{1,2}\/|\/)[^"']+\.m?js)["']/g;
// The minifier writes a dynamic import's path as a template literal: import(`./maplibre-gl.X.js`).
const DYNAMIC_IMPORT = /\bimport\(\s*[`"']((?:\.{1,2}\/|\/)[^`"']+\.m?js)[`"']\s*\)/g;

/** A page's up-front JavaScript (entries and their static imports) and what it may load later by import(). */
function jsOf(page: Document): { upFront: Set<string>; lazy: Set<string> } {
  const upFront = new Set<string>();
  const lazy = new Set<string>();
  const queue: string[] = [];
  for (const s of page.querySelectorAll("script")) {
    const src = s.getAttribute("src");
    if (src?.startsWith("/")) queue.push(path.join(DIST_DIR, src.replace(/^\//, "")));
    else if (!src) for (const m of (s.textContent ?? "").matchAll(STATIC_IMPORT)) queue.push(local(path.join(DIST_DIR, "x.js"), m[1]!));
  }
  while (queue.length) {
    const file = queue.pop()!;
    if (upFront.has(file) || !existsSync(file)) continue;
    upFront.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(STATIC_IMPORT)) queue.push(local(file, m[1]!));
    for (const m of source.matchAll(DYNAMIC_IMPORT)) lazy.add(local(file, m[1]!));
  }
  for (const f of upFront) lazy.delete(f);
  return { upFront, lazy };
}
const gz = (files: Iterable<string>) => [...files].filter(existsSync).reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);

describe("JS budget", () => {
  it.each(["regions/index.html", ...REGION_IDS.map((id) => `regions/${id}/index.html`)])(
    "%s ships 75 KB of gzipped JavaScript or less up front, and MapLibre only on demand",
    (file) => {
      const { upFront, lazy } = jsOf(doc(readDist(file)));
      const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
      console.info(`${file}: up front ${kb(gz(upFront))} gzipped, on demand ${kb(gz(lazy))} gzipped`);
      expect(gz(upFront)).toBeLessThanOrEqual(75 * 1024);
      expect([...upFront].some((f) => /maplibre/i.test(path.basename(f))), "MapLibre in the up-front JavaScript").toBe(false);
      expect([...lazy].some((f) => /maplibre/i.test(path.basename(f))), "MapLibre behind a dynamic import").toBe(true);
    },
  );
});
