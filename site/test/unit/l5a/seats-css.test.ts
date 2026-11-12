import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// L5a, card "Shared CSS patterns" (#195): seats.css resets its grid lists in
// one rule and sizes its figure SVGs in one rule, instead of once per list
// and once per figure.

const CSS = readFileSync(path.join(__dirname, "../../../src/components/seats/seats.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Each plain rule as its selector list and its body. Media blocks are read through. */
function rules(css: string): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()),
    body: m[2],
  }));
}

/** How many rules naming `selector` set `property`. */
function setters(selector: string, property: string): number {
  return rules(CSS).filter((r) => r.selectors.includes(selector) && new RegExp(`(^|;)\\s*${property}\\s*:`).test(r.body)).length;
}

describe("seats.css rule reader (self-test)", () => {
  it("counts the rules that set a property for a selector", () => {
    expect(setters(".seat-steps__list", "counter-reset")).toBe(1);
    expect(setters(".seat-steps__list", "no-such-property")).toBe(0);
  });
});

describe("seats.css says each shared pattern once", () => {
  /** The rules whose selector list names every one of `selectors` and sets `property`. */
  const sharedSetters = (selectors: string[], property: string) =>
    rules(CSS).filter((r) => selectors.every((sel) => r.selectors.includes(sel)) && new RegExp(`(^|;)\\s*${property}\\s*:`).test(r.body));

  const LISTS = [".seat-perks", ".seat-traits", ".seat-tiles", ".seat-bars", ".seat-week", ".seat-steps__list"];
  it("resets all six grid lists in one rule, and in no other", () => {
    expect(sharedSetters(LISTS, "list-style")).toHaveLength(1);
    for (const list of LISTS) expect(setters(list, "list-style"), list).toBe(1);
  });

  const SVGS = [".seat-figure .sv-map", ".seat-figure .sv-net", ".seat-trail .sv-trail", ".seat-hours .sv-hours"];
  it("sizes all four figure SVGs in one rule, and in no other", () => {
    expect(sharedSetters(SVGS, "height")).toHaveLength(1);
    for (const svg of SVGS) expect(setters(svg, "height"), svg).toBe(1);
  });
});
