// L2: the Leaderboard charts set their text in the type scale's tokens, never
// a pixel size the token gate cannot see (#120).
import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { chipLabel, cityStatus, nextIndex, writesLive } from "../../../src/components/leaderboard/city-map";
import { foundingTimeline, hqMap, hqMapNarrow, sectorBars } from "../../../src/lib/leaderboard/charts";

const text = { label: "A chart", description: "What the chart shows." };
const charts = {
  hqMap: hqMap(
    [
      { key: "Denver", count: 3 },
      { key: "Boulder", count: 2 },
    ],
    text,
  ),
  sectorBars: sectorBars(
    [
      { key: "Software", count: 4 },
      { key: "Climate", count: 2 },
    ],
    text,
  ),
  foundingTimeline: foundingTimeline(
    [
      { year: 2015, count: 1 },
      { year: 2020, count: 3 },
    ],
    text,
  ),
};

const parse = (svg: string) => new new JSDOM().window.DOMParser().parseFromString(svg, "image/svg+xml").documentElement;

describe("Leaderboard charts", () => {
  it.each(Object.entries(charts))("%s sets its text at 15 px through the token", (_, svg) => {
    const root = parse(svg);
    expect(root.getAttribute("style")).toContain("font-size: var(--t-step--1)");
    // Plot's own font-size="10" on the root sits under the inline style; no mark sets a size of its own.
    expect([...root.querySelectorAll("[font-size]")]).toEqual([]);
  });
});

// The HQ maps' outline and dots meet 3:1 on the surface band (#240). Plot sets
// a mark's colors on its group, so each shape takes the nearest ancestor's
// value. brand_tokens.yaml lists border on surface at 4.11:1 and text-dim on
// surface at 7.96:1; rule, the old color of both, is not in its contrast block.
describe("the HQ maps' contrast", () => {
  const inherited = (el: Element, attr: string): string | null => {
    for (let e: Element | null = el; e; e = e.parentElement) if (e.hasAttribute(attr)) return e.getAttribute(attr);
    return null;
  };
  const cities = [
    { key: "Denver", count: 40 },
    { key: "Boulder", count: 31 },
    { key: "Colorado Springs", count: 6 },
  ];
  const maps = { hqMap: parse(hqMap(cities, text)), hqMapNarrow: parse(hqMapNarrow(cities, text)) };

  it("self-test: reads a shape's color from its own attribute first, then its group's", () => {
    const root = parse('<svg xmlns="http://www.w3.org/2000/svg" stroke="a"><g stroke="b"><circle stroke="c"/><path/></g><rect/></svg>');
    expect(inherited(root.querySelector("circle")!, "stroke")).toBe("c");
    expect(inherited(root.querySelector("path")!, "stroke")).toBe("b");
    expect(inherited(root.querySelector("rect")!, "stroke")).toBe("a");
    expect(inherited(root.querySelector("rect")!, "fill")).toBeNull();
  });

  it.each(Object.entries(maps))("%s draws the Colorado outline in the border token", (_, root) => {
    const outline = [...root.querySelectorAll("path")];
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.map((p) => inherited(p, "stroke"))).toEqual(outline.map(() => "var(--c-border)"));
  });

  it.each(Object.entries(maps))("%s strokes every city dot in text-dim and keeps the gold fill", (_, root) => {
    const dots = [...root.querySelectorAll("circle")];
    expect(dots.length).toBe(cities.length);
    for (const d of dots) {
      expect(inherited(d, "stroke")).toBe("var(--c-text-dim)");
      expect(inherited(d, "fill")).toBe("var(--c-accent)");
    }
  });
});

// L3a: city-map.ts lays a button over each dot from these attributes, and the
// <title> names the city on hover with no script at all.
describe("the HQ maps' city dots", () => {
  const cities = [
    { key: "Denver", count: 40 },
    { key: "Boulder", count: 31 },
    { key: "Golden", count: 1 },
  ];
  it.each([
    ["hqMap", hqMap],
    ["hqMapNarrow", hqMapNarrow],
  ] as const)("%s tags each circle with its city, count and a title", (_, draw) => {
    const dots = [...parse(draw(cities, text)).querySelectorAll("circle")];
    const tags = dots.map((d) => [d.getAttribute("data-city"), Number(d.getAttribute("data-count")), d.querySelector("title")?.textContent]);
    expect(tags.sort()).toEqual([
      ["Boulder", 31, "Boulder: 31 companies"],
      ["Denver", 40, "Denver: 40 companies"],
      ["Golden", 1, "Golden: 1 company"],
    ]);
  });

  it("places dots by cx and cy, with no transform the buttons would miss", () => {
    const root = parse(hqMap(cities, text));
    for (const d of root.querySelectorAll("circle")) {
      for (let e: Element | null = d; e && e !== root; e = e.parentElement) expect(e.hasAttribute("transform")).toBe(false);
      expect(Number(d.getAttribute("cx"))).toBeGreaterThan(0);
    }
    expect(root.getAttribute("viewBox")).toBe("0 0 720 520");
  });
});

describe("the city map's keys", () => {
  it("moves with the arrows and wraps at both ends", () => {
    expect(nextIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextIndex(2, "ArrowDown", 3)).toBe(0);
    expect(nextIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextIndex(1, "ArrowUp", 3)).toBe(0);
  });

  it("jumps with Home and End, and ignores other keys and an empty map", () => {
    expect(nextIndex(1, "Home", 3)).toBe(0);
    expect(nextIndex(0, "End", 3)).toBe(2);
    expect(nextIndex(0, "Enter", 3)).toBeUndefined();
    expect(nextIndex(0, "ArrowRight", 0)).toBeUndefined();
  });

  it("says the city and its count in the live status", () => {
    expect(cityStatus("Denver", 40)).toBe("Denver: 40 companies.");
    expect(cityStatus("Golden", 1)).toBe("Golden: 1 company.");
  });
});

// Review of #84: the live status speaks on focus, click and Escape, never on
// hover, and the phone row's buttons read like the map's labels.
describe("the city map's announcements", () => {
  it("writes the live region on focus, click and clear, never on hover", () => {
    expect(writesLive("hover")).toBe(false);
    expect(writesLive("focus")).toBe(true);
    expect(writesLive("click")).toBe(true);
    expect(writesLive("clear")).toBe(true);
  });

  it("labels a phone-row button with the city and its count", () => {
    expect(chipLabel("Denver", 40)).toBe("Denver (40)");
  });
});

// Review of #84: below 40rem the Front Range dots sit 10 to 20 px apart, so
// the dots' buttons hide and a row of city buttons at least 24 px tall shows.
describe("CityPanel's phone row", () => {
  const css = readFileSync(new URL("../../../src/components/leaderboard/CityPanel.astro", import.meta.url), "utf8");
  /** The body of the first rule whose selector is exactly `selector`, found by plain string search. */
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) return "";
    const open = start + selector.length + 2;
    return css.slice(open, css.indexOf("}", open));
  };

  it("hides the dots' buttons below 40rem and shows the row there only", () => {
    expect(css).toMatch(/@media \(max-width: 40rem\) \{\s*:global\(\.city-map__layer\) \{\s*display: none;/);
    expect(css).toMatch(/@media \(max-width: 40rem\) and \(scripting: enabled\) \{\s*:global\(\.city-map__chips\) \{\s*display: flex;/);
    expect(rule(":global(.city-map__chips)")).toMatch(/display: none;[^}]*flex-wrap: wrap;/);
  });

  it("makes each row button at least 24 px tall (--s-6 is 32 px)", () => {
    expect(rule(":global(.city-map__chip)")).toContain("min-block-size: var(--s-6);");
    const tokens = readFileSync(new URL("../../../src/styles/tokens.css", import.meta.url), "utf8");
    expect(Number(tokens.match(/--s-6: (\d+)px;/)?.[1])).toBeGreaterThanOrEqual(24);
  });

  it("keeps the live status apart from the aria-hidden copy hover writes", () => {
    expect(css).toMatch(/<p class="visually-hidden" aria-live="polite" data-city-status><\/p>/);
    expect(css).toMatch(/<p class="city-panel__status" aria-hidden="true" data-city-visual>/);
  });
});
