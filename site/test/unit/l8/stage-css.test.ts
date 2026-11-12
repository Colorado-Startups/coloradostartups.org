import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The region pages' stage disclosures are controls: their edge uses the UI
// border token (4.46:1 on ground, brand_tokens.yaml), not the decorative rule
// (about 1.4:1), and their name underlines on hover (#249).

const FILE = readFileSync(new URL("../../../src/components/regions/RegionResources.astro", import.meta.url), "utf8");
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(FILE)?.[1] ?? "";

function body(selector: string): string {
  const text = STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return "";
}

describe("RegionResources stage disclosures", () => {
  it("self-test: finds no rule for a selector the style lacks", () => {
    expect(body(".no-such-rule")).toBe("");
  });

  it("draw their edge in the UI border token", () => {
    expect(body(".stage")).toMatch(/border:\s*var\(--line-hair\) solid var\(--c-border\)/);
  });

  it("underline the stage name on hover", () => {
    expect(body(".stage summary:hover .stage-name")).toMatch(/text-decoration:\s*underline/);
  });
});
