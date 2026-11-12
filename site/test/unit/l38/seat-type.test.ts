import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Seat page type on the scale (brand_tokens.yaml): the plaque h1 floors at the
// 36 px step, not between 24 and 36 px (#233), and footnote markers sit at
// 15 px with a hover underline like every other link (#232).

const CSS = readFileSync(new URL("../../../src/components/seats/seats.css", import.meta.url), "utf8");

function body(css: string, selector: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return "";
}

describe("seat page type", () => {
  it("self-test: reads one rule's body and nothing for a missing rule", () => {
    expect(body(".a { color: red; } .b { gap: 0; }", ".b")).toContain("gap: 0");
    expect(body(".a { color: red; }", ".b")).toBe("");
  });

  it("floors the plaque h1 at the 36 px step", () => {
    expect(body(CSS, ".seat-hero__plaque h1")).toMatch(/font-size:\s*clamp\(var\(--t-step-3\),/);
  });

  it("sets footnote markers at 15 px and underlines them on hover", () => {
    expect(body(CSS, ".seat-fn")).toMatch(/font-size:\s*var\(--t-step--1\)/);
    expect(body(CSS, ".seat-fn:hover")).toMatch(/text-decoration:\s*underline/);
  });
});
