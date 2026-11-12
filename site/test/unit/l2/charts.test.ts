// L2: the Leaderboard charts set their text in the type scale's tokens, never
// a pixel size the token gate cannot see (#120).
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

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
