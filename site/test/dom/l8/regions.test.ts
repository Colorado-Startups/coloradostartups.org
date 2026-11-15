// L8 over the built site (run `npm run build` first; test:content does):
// /regions/ shows the three zones on the live map, with chips and the theme
// panels; each region page shows its painting, four sourced figures, the map
// zoomed to it, its Connector seat, six resources and six honorees that
// really belong to it, each with a "see all" link; Fusion Canyon's copy rule
// holds; and MapLibre stays out of every page's entry JavaScript.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { REGION_IDS, regionLede, WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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

  it("has the region's name, lede, painting and four sourced figures", () => {
    expect(text(page.querySelector("h1"))).toBe(region.name);
    const intro = page.querySelector("section");
    expect(text(intro)).toContain(regionLede(region));
    expect(intro?.querySelector(".region-art--hero")).not.toBeNull();
    const stats = [...(intro?.querySelectorAll("[data-region-tiles] .stat") ?? [])];
    expect(stats).toHaveLength(4);
    for (const s of stats) expect(text(s.querySelector(".stat__source")).length, text(s)).toBeGreaterThan(0);
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
const DYNAMIC_IMPORT = /\bimport\(\s*["']((?:\.{1,2}\/|\/)[^"']+\.m?js)["']\s*\)/g;

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
