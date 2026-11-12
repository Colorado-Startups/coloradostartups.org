import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SOURCE, TARGET, renderTokens } from "../../scripts/sync-brand.mjs";

// tokens.css is generated from 01_doctrine/brand_tokens.yaml. A hand edit to the
// CSS, or a YAML change without a rebuild, fails here.
describe("brand tokens", () => {
  it("tokens.css equals the render of brand_tokens.yaml", () => {
    expect(readFileSync(TARGET, "utf8")).toBe(renderTokens(readFileSync(SOURCE, "utf8")));
  });

  it("declares the colors the components rely on", () => {
    const css = readFileSync(TARGET, "utf8");
    for (const name of ["ground", "surface", "text", "accent", "on-accent", "link", "community", "fire", "night", "border", "focus"]) {
      expect(css).toContain(`--c-${name}:`);
    }
  });
});
