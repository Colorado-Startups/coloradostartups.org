import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Page polish, #243: on /leaderboard/kit/ the two badge panels sit side by
// side on wide screens. The page's grid sizes and spaces them; the panel sets
// no width or outer margin of its own. The built page side is in
// test/dom/page-polish/kit-grid.test.ts.

const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), "utf8");
const style = (source: string) => (/<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the top-level rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string | undefined {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return undefined;
}

describe("badge kit grid (#243)", () => {
  it("self-test: finds a rule by its exact selector, and nothing for a missing one", () => {
    expect(rule(".a { gap: 0; } .a b { gap: 1px; }", ".a")).toContain("gap: 0");
    expect(rule(".a { gap: 0; }", ".b")).toBeUndefined();
  });

  it("lays the panels in auto-fit tracks of at least 26rem, spaced by the grid gap", () => {
    const grid = rule(style(read("pages/leaderboard/kit/index.astro")), ".kit-grid") ?? "";
    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*26rem\),\s*1fr\)\)/);
    expect(grid).toMatch(/gap:\s*var\(--s-6\)/);
  });

  it("gives the panel no max-width or outer margin of its own", () => {
    const panel = rule(style(read("components/kit/BadgeCard.astro")), ".kit-badge") ?? "";
    expect(panel).not.toMatch(/max-width|margin/);
  });
});
