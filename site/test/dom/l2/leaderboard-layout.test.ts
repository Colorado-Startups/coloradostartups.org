// L2 over the built site (run `npm run build` first): the order of the rooms
// on /leaderboard/ (#239). The charts once sat under the whole honorees table,
// about 9,900 px down at 1280 px (the design review, 2026-11-02), and the page
// closed on a third band in a row. Now the charts come before the table, and
// the page closes on "Recruit Series B" in the hearth band.
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
  it("runs hero, charts, honorees, method, recruit", () => {
    expect(rooms).toEqual(["hero", "glance", "2026-honorees", "method", "recruit"]);
  });

  it("puts the charts before the honorees table", () => {
    const glance = page.getElementById("glance")!;
    const table = main.querySelector("[data-sortable-table]")!;
    expect(glance.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("alternates lit and band grounds, then closes on the hearth", () => {
    expect(rooms.map(ground)).toEqual([
      "section--lit",
      "section--band",
      "section--lit",
      "section--band",
      "section--hearth",
    ]);
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

  it("self-test: the level check catches a skip and passes a clean outline", () => {
    expect(skippedLevels([1, 2, 3, 2, 3, 2])).toEqual([]);
    expect(skippedLevels([1, 3, 2])).toEqual(["h1 > h3"]);
  });
});
