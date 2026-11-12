import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Page polish, #255: on wide screens KeeperCard sets its text in two columns,
// so each full-row keeper card on /team/ uses its width and runs shorter.
// #428 moved the breakpoint from 60rem to 64rem: at 60rem the right column
// was 260 px wide and one list item ran three lines; at 64rem it is 285 px
// and every item fits in two (Playwright, 2026-11-02). Below the breakpoint
// the text stays one column. The DOM side (two wrappers in
// source order, disclosure last) is in test/dom/page-polish/keeper-card-columns.test.ts.

const CARD = readFileSync(new URL("../../../src/components/team/KeeperCard.astro", import.meta.url), "utf8");
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(CARD)?.[1] ?? "";

/** The body of `selector` inside the first @media block whose query matches `query`. */
function inMedia(css: string, query: RegExp, selector: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    if (!query.test(m[1]!)) continue;
    for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (r[1]!.trim() === selector) return r[2]!;
  }
  return "";
}

/** The body of `selector` outside any @media block. */
function topLevel(css: string, selector: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
  for (const r of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (r[1]!.trim() === selector) return r[2]!;
  return "";
}

const WIDE = /min-width:\s*64rem/;

describe("KeeperCard columns (#255, #428)", () => {
  it("self-test: reads a rule inside a matching media block only, and a top-level rule outside it", () => {
    const css = "@media (min-width: 64rem) { .a { display: grid; } } .a { color: blue; }";
    expect(inMedia(css, WIDE, ".a")).toContain("grid");
    expect(inMedia(css, /min-width:\s*40rem/, ".a")).toBe("");
    expect(topLevel(css, ".a")).toContain("blue");
    expect(topLevel(css, ".a")).not.toContain("grid");
  });

  it("starts no two-column rule at 60rem, where the right column was too narrow", () => {
    expect(inMedia(STYLE, /min-width:\s*60rem/, ".keeper__text")).toBe("");
  });

  it("lays the text in two columns at 64rem and up", () => {
    const rule = inMedia(STYLE, WIDE, ".keeper__text");
    expect(rule).toMatch(/display:\s*grid/);
    const tracks = /grid-template-columns:\s*([^;]+);/.exec(rule)?.[1]?.trim() ?? "";
    expect(tracks.split(/\s+(?![^(]*\))/)).toHaveLength(2);
  });

  it("keeps one column below the breakpoint", () => {
    expect(topLevel(STYLE, ".keeper__text")).not.toMatch(/display:\s*grid/);
  });
});
