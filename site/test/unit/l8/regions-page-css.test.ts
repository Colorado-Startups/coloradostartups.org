import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { frontRangeMap } from "../../../src/lib/regions/map";
import { REGIONS } from "../../../src/lib/regions/match";

// /regions/ draws its map 420 units wide; a 375 px phone shows it 327 px wide,
// so 15-unit labels drew near 11 px (#248). Below 30rem the labels step up
// the type scale, and the region names, which carry their own size, step up
// one more. The drawn sizes below are computed: units x shown width / map
// width, with the page's 24 px gutters (#329).

const PAGE = readFileSync(new URL("../../../src/pages/regions/index.astro", import.meta.url), "utf8");
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(PAGE)?.[1] ?? "";

/** The body of `selector` inside the first @media block whose query matches `query`. */
function inMedia(css: string, query: RegExp, selector: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    if (!query.test(m[1]!)) continue;
    for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (r[1]!.trim() === selector) return r[2]!;
  }
  return "";
}

describe("/regions/ map labels on phones", () => {
  it("self-test: reads a rule inside a matching media block only", () => {
    const css = "@media (max-width: 10rem) { .a { color: red; } } .a { color: blue; }";
    expect(inMedia(css, /max-width:\s*10rem/, ".a")).toContain("red");
    expect(inMedia(css, /max-width:\s*20rem/, ".a")).toBe("");
  });

  it("step city, peak and note labels up to 21 units", () => {
    expect(inMedia(STYLE, /max-width:\s*30rem/, ".map-layout :global(.plot text)")).toMatch(/font-size:\s*var\(--t-step-1\)/);
  });

  it("step region names up to 24 units", () => {
    expect(inMedia(STYLE, /max-width:\s*30rem/, ".map-layout :global(.plot text[font-size])")).toMatch(/font-size:\s*var\(--t-step-2\)/);
  });
});

const TOKENS = readFileSync(new URL("../../../src/styles/tokens.css", import.meta.url), "utf8");
/** A type token's size in px, from tokens.css (rem at 16 px). */
const px = (token: string) => Number(new RegExp(`--${token}:\\s*([\\d.]+)rem`).exec(TOKENS)?.[1]) * 16;
const MAP_WIDTH = Number(
  new JSDOM(frontRangeMap(REGIONS, { label: "a", description: "b" }), { contentType: "image/svg+xml" }).window.document.documentElement
    .getAttribute("viewBox")
    ?.split(" ")[2],
);
const GUTTERS = 48; // global.css .wrap: 100% - 2 * --s-5
const BREAKPOINT = Number(/@media\s*\(max-width:\s*([\d.]+)rem\)\s*\{\s*\.map-layout :global\(\.plot text\)/.exec(STYLE.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1]) * 16;

describe("/regions/ map drawn text sizes (#329)", () => {
  it("self-test: reads the scale tokens and the map width", () => {
    expect([px("t-step--1"), px("t-step-1"), px("t-step-2")]).toEqual([15, 21, 24]);
    expect(MAP_WIDTH).toBeGreaterThan(0);
  });

  it("switches to the phone sizes at every width where the map draws smaller than its units", () => {
    expect(MAP_WIDTH + GUTTERS).toBeLessThanOrEqual(BREAKPOINT);
  });

  it.each([360, 375])("draws labels at 15 px or more on a %i px phone", (screen) => {
    const scale = Math.min(1, (screen - GUTTERS) / MAP_WIDTH);
    expect(px("t-step-1") * scale).toBeGreaterThanOrEqual(15);
    expect(px("t-step-2") * scale).toBeGreaterThanOrEqual(15);
  });
});
