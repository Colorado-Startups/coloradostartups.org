import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// On /get-involved/apply/, each h2 sat 16 px under the list above it and
// 24 px over its own, so it read as part of the wrong section (#235). The
// page now opens 48 px above every h2 after the first.

const PAGE = readFileSync(new URL("../../../src/pages/get-involved/apply/index.astro", import.meta.url), "utf8");
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(PAGE)?.[1] ?? "";

function body(selector: string): string {
  const text = STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return "";
}

describe("/get-involved/apply/ headings", () => {
  it("open more space above each h2 than the h2 leaves below it", () => {
    expect(body(".wrap.stack > h2:not(:first-child)")).toMatch(/margin-top:\s*var\(--s-7\)/);
  });

  it("self-test: finds no rule for a selector the style lacks", () => {
    expect(body(".no-such-rule")).toBe("");
  });
});
