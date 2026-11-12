// L2: each Leaderboard chart's axis label sits clear of its tick numbers
// (#295). Plot places text by transform, so the check reads positions from
// the SVG and allows one em (15 px, var(--t-step--1)) for each line of text,
// more than the glyphs take.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { foundingTimeline, sectorBars } from "../../../src/lib/leaderboard/charts";

const EM = 15;
const text = { label: "A chart", description: "What the chart shows." };

const parse = (svg: string) => new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;

/** A text's y: its own translate plus its group's. */
function yOf(el: Element): number {
  const y = (attr: string | null) => Number(/translate\([-\d.]+,([-\d.]+)\)/.exec(attr ?? "")?.[1] ?? 0);
  return y(el.getAttribute("transform")) + y(el.parentElement?.getAttribute("transform") ?? null);
}

const texts = (root: Element) => [...root.querySelectorAll("text")];
const numbers = (root: Element, anchor: string) =>
  texts(root).filter((t) => /^\d+$/.test(t.textContent ?? "") && t.getAttribute("y") === anchor);

describe("Leaderboard chart axis labels", () => {
  it("self-test: adds a text's translate to its group's", () => {
    const root = parse('<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(0,9)"><text transform="translate(5,88)">1</text></g></svg>');
    expect(yOf(root.querySelector("text")!)).toBe(97);
  });

  it("puts the sector chart's x label below its tick numbers", () => {
    const sectors = Array.from({ length: 22 }, (_, i) => ({ key: `Sector ${i}`, count: 22 - i }));
    const root = parse(sectorBars(sectors, text));
    const label = texts(root).find((t) => t.textContent === "Companies →")!;
    // x tick numbers hang from their y (0.71em); the label's baseline is its y.
    const ticksBottom = Math.max(...numbers(root, "0.71em").map((t) => yOf(t) + EM));
    expect(yOf(label) - EM).toBeGreaterThanOrEqual(ticksBottom);
  });

  // Every year labelled, so the check does not rest on the data leaving the
  // middle years blank (#334).
  it("puts the founding timeline's x label below its year numbers", () => {
    const years = Array.from({ length: 6 }, (_, i) => ({ year: 2015 + i * 5, count: i + 1 }));
    const root = parse(foundingTimeline(years, text));
    const label = texts(root).find((t) => t.textContent === "Year founded")!;
    // Year numbers hang from their y (0.71em); the label's baseline is its y.
    const ticksBottom = Math.max(...texts(root).filter((t) => /^\d{4}$/.test(t.textContent ?? "")).map((t) => yOf(t) + EM));
    expect(yOf(label) - EM).toBeGreaterThanOrEqual(ticksBottom);
  });

  it("puts the founding timeline's y label above its top tick number", () => {
    const years = Array.from({ length: 30 }, (_, i) => ({ year: 1996 + i, count: (i % 7) + 1 }));
    const root = parse(foundingTimeline(years, text));
    const label = texts(root).find((t) => t.textContent === "↑ Companies")!;
    // The label hangs from its y; y tick numbers are centered on theirs (0.32em).
    const ticksTop = Math.min(...numbers(root, "0.32em").map((t) => yOf(t) - EM / 2));
    expect(yOf(label) + EM).toBeLessThanOrEqual(ticksTop);
  });
});
