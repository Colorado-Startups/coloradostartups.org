import { describe, expect, it } from "vitest";

import { THEMES, themeOf } from "../../../src/lib/leaderboard/themes";
import { readDist } from "../pages";

// L5b: the Leaderboard's honorees table as built (#145). Run `npm run build`
// first (test:content does).

const doc = new DOMParser().parseFromString(readDist("leaderboard/index.html"), "text/html");
const board = doc.querySelector("main [data-sortable-table]")!;
const rows = [...board.querySelectorAll("tbody tr")];

describe("/leaderboard/ honorees table", () => {
  it("has no Founded column", () => {
    const headings = [...board.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(headings).toEqual(["Company", "Sector", "HQ city", "Boards", "Sources"]);
    expect(rows.length).toBeGreaterThan(0);
    for (const tr of rows) expect(tr.cells).toHaveLength(5);
  });

  it("states a founding year only where the data has one, never 'Not stated'", () => {
    expect(board.textContent).not.toContain("Not stated");
    for (const span of board.querySelectorAll(".founded")) expect(span.textContent).toMatch(/^Founded \d{4}$/);
  });

  it("gives every row the sector and city the filter reads, matching its cells", () => {
    for (const tr of rows) {
      const cells = [...tr.querySelectorAll("td")];
      expect(cells[0]?.dataset.sort, tr.id).toBe((tr as HTMLElement).dataset.sector);
      expect(cells[1]?.dataset.sort, tr.id).toBe((tr as HTMLElement).dataset.city);
    }
  });

  it("ships the filter form hidden until its script runs, with one option per sector and city", () => {
    const form = board.querySelector<HTMLFormElement>("form[data-honoree-filters]")!;
    expect(form.getAttribute("role")).toBe("search");
    expect(form.hidden).toBe(true);
    const options = (name: string) => [...form.querySelectorAll(`select[name=${name}] option`)].slice(1).map((o) => o.textContent);
    const distinct = (key: "sector" | "city") => new Set(rows.map((tr) => (tr as HTMLElement).dataset[key])).size;
    expect(options("sector")).toHaveLength(distinct("sector"));
    expect(options("city")).toHaveLength(distinct("city"));
  });

  // The redesign (2026-11-15): theme chips over the table, one radio group in
  // the filter form, each with the count of rows it shows.
  it("offers All and each theme as a chip, counted from the rows", () => {
    const form = board.querySelector<HTMLFormElement>("form[data-honoree-filters]")!;
    const chips = [...form.querySelectorAll<HTMLInputElement>(".theme-chips input[type=radio][name=theme]")];
    expect(chips.map((c) => c.value)).toEqual(["", ...THEMES.map((t) => t.id)]);
    expect(chips[0]!.hasAttribute("checked")).toBe(true);
    const count = (input: HTMLInputElement) => Number(input.closest("label")?.querySelector(".theme-chip__count")?.textContent);
    expect(count(chips[0]!)).toBe(rows.length);
    for (const chip of chips.slice(1)) {
      const matching = rows.filter((tr) => (tr as HTMLElement).dataset.theme === chip.value).length;
      expect(count(chip), chip.value).toBe(matching);
      expect(matching, `${chip.value} has honorees`).toBeGreaterThan(0);
    }
  });

  it("stamps every row with the theme of its sector", () => {
    for (const tr of rows) {
      const el = tr as HTMLElement;
      expect(el.dataset.theme, tr.id).toBe(themeOf(el.dataset.sector ?? ""));
    }
  });
});
