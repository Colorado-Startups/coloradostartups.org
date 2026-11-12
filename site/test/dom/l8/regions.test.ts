// L8 over the built site (run `npm run build` first; test:content does):
// /regions/ and the three region pages render from data, every listed
// resource and honoree really belongs to the region, the organizer seat is
// right, Fusion Canyon's copy rule holds, and the pages fit the JS budget.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { REGION_IDS, WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { regionForCity, REGIONS } from "../../../src/lib/regions/match";
import { INSIDE_A_CANYON } from "../../unit/l8/canyon-rule";
import { DIST_DIR, readDist, SITE_DIR } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const index = doc(readDist("regions/index.html"));
const pages = Object.fromEntries(REGION_IDS.map((id) => [id, doc(readDist(`regions/${id}/index.html`))]));
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
// SHOWN_FIRST in src/components/regions/RegionHonorees.astro.
const HONOREES_SHOWN_FIRST = 12;

const positions = parse(readFileSync(path.resolve(SITE_DIR, "..", "data", "team", "positions.yaml"), "utf8")) as {
  id: string;
  region?: string;
  title: string;
  status: string;
}[];

describe("/regions/", () => {
  it("lists the three regions in order, each linking to its page with tagline and cities", () => {
    const cards = [...index.querySelectorAll<HTMLElement>("[data-region]")];
    expect(cards.map((c) => c.dataset.region)).toEqual(REGIONS.map((r) => r.id));
    for (const [i, r] of REGIONS.entries()) {
      const card = cards[i]!;
      expect(card.querySelector("h3 a")?.getAttribute("href")).toBe(`/regions/${r.id}/`);
      expect(text(card)).toContain(r.tagline);
      for (const city of r.cities) expect(text(card)).toContain(city);
    }
  });

  it("draws the Front Range map as one labelled image with a caption and a data table", () => {
    const fig = index.querySelector("figure.chart");
    const svg = fig?.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toMatch(/map/i);
    expect(text(fig?.querySelector("figcaption"))).toMatch(/Fusion Canyon is the northern region/);
    const rows = [...(fig?.querySelectorAll("tbody tr") ?? [])].map((tr) => text(tr.querySelector("th")));
    expect(rows).toEqual(REGIONS.map((r) => r.name));
  });

  it("has a line for founders elsewhere in Colorado", () => {
    const section = index.getElementById("elsewhere")?.parentElement;
    expect(text(section)).toMatch(/anywhere else in Colorado\? You are part of this community too\./);
  });
});

describe.each(REGIONS.map((r) => [r.id, r] as const))("/regions/%s/", (id, region) => {
  const page = pages[id]!;

  it("has the region's name, tagline, summary and cities", () => {
    expect(text(page.querySelector("h1"))).toBe(region.name);
    const intro = text(page.querySelector("section"));
    expect(intro).toContain(region.tagline);
    expect(intro).toContain(region.summary.replace(/\s+/g, " ").trim());
    for (const city of [...region.cities, ...region.nearby]) expect(intro).toContain(city);
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
      // A seat that takes applications links to the form (L19).
      expect(text(card)).toContain("Open seat");
      expect(card?.querySelector("a[data-apply]")?.getAttribute("href")).toBe(`/get-involved/apply/?role=${position.id}`);
      expect(card?.querySelector("a[data-raise-hand]")).toBeNull();
    } else if (position.status === "open") {
      expect(text(card)).toContain("Open seat");
      const raise = card?.querySelector<HTMLAnchorElement>("a[data-raise-hand]");
      expect(text(raise)).toBe(`Email us about this seat (${position.title})`);
      expect(raise?.getAttribute("href")).toMatch(/^mailto:info@coloradostartups\.org\?subject=/);
      expect(decodeURIComponent(raise?.getAttribute("href") ?? "")).toContain(position.title);
      expect(text(card)).toContain("info@coloradostartups.org");
    }
  });

  it("lists only Startup Resources whose city maps to this region", () => {
    const items = [...page.querySelectorAll<HTMLElement>("[data-region-resources] li[data-city]")];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(regionForCity(li.dataset.city!), li.dataset.id).toBe(id);
    const lede = text(page.querySelector("[data-region-resources] p"));
    expect(lede).toContain(`Startup Resources lists ${items.length} resource`);
  });

  it("links each of its cities into the directory's city filter", () => {
    const links = [...page.querySelectorAll<HTMLAnchorElement>("[data-region-resources] .city-links a")];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const city = new URLSearchParams(a.getAttribute("href")!.split("?")[1]).get("city")!;
      expect(regionForCity(city)).toBe(id);
    }
  });

  it("lists only honorees headquartered in this region, with no investing language", () => {
    const section = page.querySelector("[data-region-honorees]");
    const items = [...(section?.querySelectorAll<HTMLElement>("li[data-hq]") ?? [])];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(regionForCity(li.dataset.hq!), li.dataset.id).toBe(id);
    // Decision 17 and the Leaderboard purpose limit.
    expect(text(section)).not.toMatch(/\binvest|\bfund(?:s|ing|raise)?\b|\bseries [a-z]\b|\bdeal flow\b/i);
  });

  // A long list shows its first names and folds the rest into a closed native
  // <details>, every name still in the page; a short list shows whole (#250).
  it("folds a long honoree list behind Show all, and shows a short one whole", () => {
    const section = page.querySelector("[data-region-honorees]")!;
    const all = [...section.querySelectorAll("li[data-hq]")];
    const shown = all.filter((li) => !li.closest("details"));
    const more = section.querySelector<HTMLDetailsElement>("details[data-honorees-more]");
    if (all.length <= HONOREES_SHOWN_FIRST) {
      expect(more).toBeNull();
      expect(shown).toHaveLength(all.length);
      return;
    }
    expect(shown).toHaveLength(HONOREES_SHOWN_FIRST);
    expect(more?.hasAttribute("open"), "starts closed").toBe(false);
    expect(more?.querySelectorAll("li[data-hq]")).toHaveLength(all.length - HONOREES_SHOWN_FIRST);
    expect(text(more?.querySelector("summary .when-closed"))).toBe(`Show all ${all.length} honorees`);
    const lede = text(section.querySelector("p"));
    expect(lede).toContain(`include ${all.length} companies`);
  });

  it("points to the Slack and the event calendar", () => {
    const meet = page.getElementById("meet")?.parentElement;
    const hrefs = [...(meet?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining([WAYS_IN.slack, WAYS_IN.events]));
  });

  // The other two regions are the same cards /regions/ shows, art and all (#204).
  it("shows the other two regions as their /regions/ cards", () => {
    const others = REGIONS.filter((r) => r.id !== id);
    const cards = [...page.querySelectorAll(".others [data-region]")];
    expect(cards.map((c) => c.getAttribute("data-region"))).toEqual(others.map((r) => r.id));
    for (const [i, card] of cards.entries()) {
      expect(card.querySelector(`a[href="/regions/${others[i]!.id}/"]`)).not.toBeNull();
      expect(card.querySelector(".region-art--card img, .region-art--card .art-placeholder")).not.toBeNull();
      expect(text(card)).toBe(text(index.querySelector(`[data-region='${others[i]!.id}']`)));
    }
  });
});

// The data must exercise both branches of the honoree test above: at least one
// region folds its list and at least one shows it whole (#250).
describe("honoree lists across the regions", () => {
  it("fold in one region at least and show whole in another", () => {
    const folded = REGION_IDS.filter((id) => pages[id]!.querySelector("[data-honorees-more]"));
    expect(folded.length).toBeGreaterThan(0);
    expect(folded.length).toBeLessThan(REGION_IDS.length);
  });
});

describe("Fusion Canyon on the page", () => {
  const body = text(pages["fusion-canyon"]!.querySelector("main"));

  it("is named for the canyon and built on the plain, never inside it", () => {
    expect(body).toMatch(/named for the canyon and built on the plain/i);
    expect(body).not.toMatch(INSIDE_A_CANYON);
  });
});

// PLAN.md, Gates: a JS budget of 75 KB gzipped or less on content pages (goal).
describe("JS budget", () => {
  it.each(["regions/index.html", ...REGION_IDS.map((id) => `regions/${id}/index.html`)])(
    "%s ships 75 KB of gzipped JavaScript or less",
    (file) => {
      const page = doc(readDist(file));
      const srcs = [...page.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")!);
      let bytes = 0;
      for (const src of srcs) {
        const local = path.join(DIST_DIR, src.replace(/^\//, ""));
        if (existsSync(local)) bytes += gzipSync(readFileSync(local)).length;
      }
      expect(bytes).toBeLessThanOrEqual(75 * 1024);
    },
  );
});
