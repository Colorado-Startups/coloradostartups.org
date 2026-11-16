// L8 over the built site (run `npm run build` first; test:content does):
// /regions/ shows the three regions side by side (step W6). The columns follow
// the data order, never the counts; every tally shows its number as text with
// a source caption; each bar scales within its own tally; no copy ranks a
// region; and no member count appears.
import { describe, expect, it } from "vitest";

import { REGIONS } from "../../../src/lib/regions/match";
import { readDist } from "../pages";

const doc = new DOMParser().parseFromString(readDist("regions/index.html"), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const tallies = doc.querySelector(".tallies");
const rows = [...(tallies?.querySelectorAll<HTMLElement>("tbody tr[data-tally]") ?? [])];

describe("/regions/ tallies", () => {
  it("heads one column per region, in data order, with its crest and name", () => {
    const cols = [...(tallies?.querySelectorAll<HTMLElement>("thead th[data-region]") ?? [])];
    expect(cols.map((c) => c.dataset.region)).toEqual(REGIONS.map((r) => r.id));
    for (const [i, r] of REGIONS.entries()) {
      expect(text(cols[i]), "the name sits beside the region color").toContain(r.name);
      expect(cols[i]!.querySelector(".tallies__swatch")).not.toBeNull();
      expect(cols[i]!.querySelector("img.tallies__crest")?.getAttribute("alt")?.length).toBeGreaterThan(0);
    }
  });

  it("shows the three tallies, each with a source caption", () => {
    expect(rows.map((r) => r.dataset.tally)).toEqual(["companies", "events", "resources"]);
    for (const row of rows) expect(text(row.querySelector("th .tally__source")), row.dataset.tally).toMatch(/^Source: \S.+\.$/);
  });

  it("dates the events window to the build", () => {
    const events = rows.find((r) => r.dataset.tally === "events");
    expect(text(events?.querySelector(".tally__source"))).toMatch(/as of \d{4}-\d{2}-\d{2}, the day this page was built/);
  });

  it("names the region beside every number, for the stacked layout", () => {
    for (const row of rows) {
      for (const [i, c] of [...row.querySelectorAll("td[data-region]")].entries()) {
        expect(text(c.querySelector(".tally__region"))).toBe(REGIONS[i]!.name);
      }
    }
  });

  it("gives every bar its number as text, in data order, scaled within its own tally", () => {
    for (const row of rows) {
      const cells = [...row.querySelectorAll<HTMLElement>("td[data-region]")];
      expect(cells.map((c) => c.dataset.region)).toEqual(REGIONS.map((r) => r.id));
      const counts = cells.map((c) => text(c.querySelector(".tally__value")));
      for (const n of counts) expect(n, row.dataset.tally).toMatch(/^\d+$/);
      const max = Math.max(...counts.map(Number));
      for (const [i, c] of cells.entries()) {
        const share = Number(/--share:\s*([\d.]+)/.exec(c.querySelector(".tally__bar")?.getAttribute("style") ?? "")?.[1]);
        expect(share, `${row.dataset.tally} ${c.dataset.region}`).toBeCloseTo(max === 0 ? 0 : Number(counts[i]) / max, 2);
      }
    }
  });

  it("ranks no region and shows no member count", () => {
    const section = text(tallies?.closest("section"));
    expect(section).not.toMatch(/\b(?:top|leads?|leading|winners?|wins?|ranks?|ranked|best|most|largest|biggest|#\s?1)\b/i);
    expect(section).not.toMatch(/\bmembers?\b/i);
  });
});
