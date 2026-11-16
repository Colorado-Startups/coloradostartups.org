// L2 over the built site (run `npm run build` first): the order of the rooms
// on /leaderboard/ (#239, the redesign of 2026-11-15). The charts come before
// the honorees table, "How the Leaderboard works" folds into a closed
// <details> under the table, and the page closes on a short nominate band in
// the hearth. Nothing on the page ties the Leaderboard to investing
// (decision 17), so the old "Recruit Series B" band is gone.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readDist, SITE_DIR } from "../pages";

const page = new DOMParser().parseFromString(readDist("leaderboard/index.html"), "text/html");
const main = page.querySelector("main")!;
const sections = [...main.querySelectorAll<HTMLElement>("section.section")];

/** The id each room is labelled by, or "hero" for the unlabelled first room. */
const rooms = sections.map((s) => s.getAttribute("aria-labelledby") ?? "hero");
const ground = (id: string) =>
  [...(sections[rooms.indexOf(id)]?.classList ?? [])].find((c) => c.startsWith("section--")) ?? "";

/** Heading levels that skip a level on the way down, as "h1 > h3". */
function skippedLevels(levels: number[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i]! > levels[i - 1]! + 1) out.push(`h${levels[i - 1]} > h${levels[i]}`);
  }
  return out;
}

describe("/leaderboard/ room order", () => {
  it("runs hero, charts, honorees, nominate", () => {
    expect(rooms).toEqual(["hero", "glance", "2026-honorees", "nominate"]);
  });

  it("puts the charts before the honorees table", () => {
    const glance = page.getElementById("glance")!;
    const table = main.querySelector("[data-sortable-table]")!;
    expect(glance.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("alternates lit and band grounds, then closes on the hearth", () => {
    expect(rooms.map(ground)).toEqual(["section--lit", "section--band", "section--lit", "section--hearth"]);
  });

  // A class with no rule would draw nothing; the hearth band lives in global.css.
  it("uses a hearth band that global.css defines", () => {
    const css = readFileSync(path.join(SITE_DIR, "src", "styles", "global.css"), "utf8");
    expect(css).toMatch(/\.section--hearth\s*\{[^}]*background/);
  });

  it("labels each room with a heading inside it, and skips no heading level", () => {
    for (const s of sections.slice(1)) {
      const id = s.getAttribute("aria-labelledby")!;
      const heading = page.getElementById(id);
      expect(heading?.tagName, id).toBe("H2");
      expect(s.contains(heading), id).toBe(true);
    }
    const levels = [...main.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    expect(skippedLevels(levels)).toEqual([]);
  });

  it("folds the method into a closed details under the table, at the #method anchor", () => {
    const method = page.getElementById("method")!;
    expect(method.tagName).toBe("DETAILS");
    expect(method.hasAttribute("open")).toBe(false);
    expect(method.querySelector("summary")?.textContent?.trim()).toBe("How the Leaderboard works");
    const table = main.querySelector("[data-sortable-table]")!;
    expect(table.compareDocumentPosition(method) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Decision 17: the Leaderboard is never tied to investing. The method may
  // still say the edition leaves investment firms out, so it is read apart.
  it("says nothing about investing outside the method", () => {
    const rest = main.cloneNode(true) as HTMLElement;
    rest.querySelector("#method")?.remove();
    expect(rest.textContent ?? "").not.toMatch(/\binvest|\bVC\b|\bventure (?:firm|fund|capital)|\bseries [a-z]\b/i);
  });

  it("self-test: the level check catches a skip and passes a clean outline", () => {
    expect(skippedLevels([1, 2, 3, 2, 3, 2])).toEqual([]);
    expect(skippedLevels([1, 3, 2])).toEqual(["h1 > h3"]);
  });
});

// L3a: the "Where they are" map's dots open a city panel (city-map.ts). The
// built page carries what the script needs, and stays complete without it.
describe("/leaderboard/ city map", () => {
  const figure = page.getElementById("chart-map-title")!.closest("figure")!;
  const panel = figure.querySelector<HTMLElement>("[data-city-panel]")!;
  const circles = [...figure.querySelectorAll("circle")];
  const templates = [...panel.querySelectorAll("template")];

  it("tags every dot with its city and count, and keeps a title on each", () => {
    expect(circles.length).toBeGreaterThan(0);
    for (const c of circles) {
      expect(c.getAttribute("data-city"), c.outerHTML).toBeTruthy();
      expect(Number(c.getAttribute("data-count"))).toBeGreaterThan(0);
      expect(c.querySelector("title")?.textContent).toContain(c.getAttribute("data-city")!);
    }
  });

  it("has a panel with a polite live status that the dots' buttons point at", () => {
    expect(panel.id).toBe("chart-map-panel");
    expect(panel.querySelector("[data-city-status]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("lists each dot's companies, as many as the dot counts, each linking to a table row", () => {
    const byCity = new Map(templates.map((t) => [t.getAttribute("data-city"), t]));
    for (const c of circles) {
      const t = byCity.get(c.getAttribute("data-city"));
      expect(t, c.getAttribute("data-city")!).toBeDefined();
      const links = [...t!.content.querySelectorAll("a")];
      expect(links.length).toBe(Number(c.getAttribute("data-count")));
      for (const a of links) {
        const row = page.getElementById(a.getAttribute("href")!.slice(1));
        expect(row?.tagName, a.getAttribute("href")!).toBe("TR");
      }
    }
  });

  it("adds no button before the script runs", () => {
    expect(figure.querySelector("button")).toBeNull();
  });
});
