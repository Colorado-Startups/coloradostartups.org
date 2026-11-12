import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { columnsPx, declsAt, GLOBAL_CSS, gridRow, lengthPx, paddingTopPx, SEATS_CSS, valueOf, wrapAt } from "./css";

// The seat card grids drop empty tracks, so a short row spans the width at
// 1280 px instead of stopping three quarters across (#207). The other seats'
// grid names .hall-grid too, so its rule must outweigh .hall-grid's own.

const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), "utf8");

function columns(css: string, selector: string): string | undefined {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() === selector) return /grid-template-columns:\s*([^;]+);/.exec(m[2]!)?.[1]?.trim();
  }
  return undefined;
}

describe("seat card grids", () => {
  it("self-test: reads a rule's columns and nothing for a missing rule", () => {
    expect(columns(".a { grid-template-columns: repeat(auto-fit, 1fr); }", ".a")).toBe("repeat(auto-fit, 1fr)");
    expect(columns(".a { gap: 0; }", ".b")).toBeUndefined();
  });

  it("let the other seats fill the row, with a rule that outweighs .hall-grid", () => {
    expect(columns(read("components/seats/seats.css"), ".hall-grid.seat-others")).toMatch(/^repeat\(auto-fit,/);
  });

  it("let the /get-involved/ rows fill the width", () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(read("pages/get-involved/index.astro"))?.[1] ?? "";
    expect(columns(style, ".seat-grid")).toMatch(/^repeat\(auto-fit,/);
  });
});

// The perks and the tiles sit straight in a section's .wrap. Their grids are
// read from seats.css at each screen width and laid out in that wrap (#231).
const PERKS = (parse(readFileSync(new URL("../../../../data/positions/common.yaml", import.meta.url), "utf8")) as { perks: string[] }).perks.length;

/** How `items` cards lay out in the grid seats.css gives `selector` on a screen `screen` px wide. */
function layout(selector: string, screen: number, items: number) {
  const decls = declsAt(SEATS_CSS, screen, [selector]);
  return gridRow(valueOf(decls, "grid-template-columns") ?? "none", wrapAt(screen), lengthPx(valueOf(decls, "gap") ?? "none"), items);
}

describe("perk and tile grids", () => {
  it("self-test: auto-fill keeps empty tracks, auto-fit drops them, and media rules win by width", () => {
    expect(gridRow("repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr))", 1180, 12, 4).tracks).toBe(7);
    expect(gridRow("repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr))", 1180, 12, 4)).toEqual({ tracks: 4, track: 286, reach: 1180 });
    expect(gridRow("repeat(3, minmax(0, 1fr))", 656, 16, 5).tracks).toBe(3);
    const css = ".p { grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: var(--s-4); } @media (max-width: 72rem) { .p { grid-template-columns: minmax(0, 1fr); } }";
    expect(valueOf(declsAt(css, 1280, [".p"]), "grid-template-columns")).toMatch(/^repeat/);
    expect(valueOf(declsAt(css, 1152, [".p"]), "grid-template-columns")).toBe("minmax(0, 1fr)");
    expect(PERKS).toBe(5);
  });

  it("puts all five perks in one row at 1280 px", () => {
    expect(layout(".seat-perks", 1280, PERKS).tracks).toBeGreaterThanOrEqual(PERKS);
  });

  // The design review found the fifth perk alone on a second row at 1280 px.
  // Checked at every width, so the lone perk cannot move to another band.
  it("never leaves a perk alone on its row, from 360 to 1600 px", () => {
    const lone: number[] = [];
    for (let screen = 360; screen <= 1600; screen++) {
      const { tracks } = layout(".seat-perks", screen, PERKS);
      if (tracks > 1 && PERKS % tracks === 1) lone.push(screen);
    }
    expect(lone.length, `a perk alone from ${lone[0]} to ${lone.at(-1)} px`).toBe(0);
  });

  it("gives every perk card at least 13rem when perks share a row", () => {
    for (let screen = 360; screen <= 1600; screen++) {
      const { tracks, track } = layout(".seat-perks", screen, PERKS);
      if (tracks > 1) expect(track, `${screen} px`).toBeGreaterThanOrEqual(13 * 16);
    }
  });

  // The Slack Community Lead's four tiles sit in the wrap, and stopped near
  // x 727 at 1280 px: seven auto-fill tracks, three of them empty.
  it("spreads a short row of tiles across the wrap", () => {
    expect(layout(".seat-tiles", 1280, 4).reach).toBeCloseTo(wrapAt(1280));
  });

  // On the Connector pages the tiles sit in a figure split's text column,
  // 460 px at 1280 px beside the 43rem drawing (#367), so two to a row
  // (review of #490).
  it("puts tiles two to a row in a figure split's text column at 1280 px", () => {
    const split = declsAt(SEATS_CSS, 1280, [".seat-split", ".seat-split--figure"]);
    const text = columnsPx(valueOf(split, "grid-template-columns") ?? "none", wrapAt(1280), lengthPx(valueOf(split, "gap") ?? "none"))[1]!;
    const tiles = declsAt(SEATS_CSS, 1280, [".seat-tiles"]);
    const row = gridRow(valueOf(tiles, "grid-template-columns") ?? "none", text, lengthPx(valueOf(tiles, "gap") ?? "none"), 4);
    expect(text).toBe(460);
    expect(row.tracks).toBe(2);
    expect(row.reach).toBeCloseTo(text);
  });
});

// The design review measured the Claude 101 link at 74 by 21 px on a 375 px
// phone (#234). The link stays inline, so a long course name wraps beside its
// color swatch; an inline-block link wrapped it below (review of #490). An
// inline box is its font's content area plus its block padding: the review
// measured 45 px in Chrome with 12 px of padding, a 21 px content area in
// 18 px type. 1.15 em bounds that content area from below.
describe("course links", () => {
  const body = /\nbody \{([^}]*)\}/.exec(GLOBAL_CSS)?.[1] ?? "";
  const font = lengthPx(/font-size:\s*([^;]+);/.exec(body)?.[1] ?? "none");
  const link = declsAt(SEATS_CSS, 375, [".seat-courses tbody th a"]);

  it("self-test: reads body text's size from global.css", () => {
    expect(font).toBe(18);
    expect(paddingTopPx([["padding", "var(--s-2) var(--s-3)"], ["padding-block", "0"]])).toBe(0);
    expect(paddingTopPx([["padding-block", "var(--s-3)"]])).toBe(12);
  });

  it("stay inline and reach the 44 px tap target goal", () => {
    expect(valueOf(link, "display")).toBeUndefined();
    expect(1.15 * font + 2 * paddingTopPx(link)).toBeGreaterThanOrEqual(44);
  });

  it("start their text level with the course length beside them", () => {
    const th = declsAt(SEATS_CSS, 375, [".seat-courses th", ".seat-courses tbody th"]);
    const td = declsAt(SEATS_CSS, 375, [".seat-courses td", ".seat-courses tbody td"]);
    // An inline link's padding moves no text, so the cells alone set where it starts.
    expect(paddingTopPx(th)).toBe(paddingTopPx(td));
  });
});
