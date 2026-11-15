import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

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

  // The color block copies brand v3's light set (Colorado-Startups/brand
  // dist/tokens.json, pulled at the brand.lock.json tag by scripts/brand/pull.mjs).
  it("matches the brand's tokens.json, role for role", () => {
    const brand = JSON.parse(readFileSync(path.join(__dirname, "../../public/art/brand/tokens.json"), "utf8")) as {
      color: Record<string, { $value?: { hex: string } }>;
    };
    const site = (YAML.parse(readFileSync(SOURCE, "utf8")) as { color: Record<string, string> }).color;
    const roles = Object.keys(brand.color).filter((k) => !k.startsWith("$"));
    expect(Object.keys(site).sort()).toEqual(roles.sort());
    for (const role of roles) expect(site[role].toUpperCase(), role).toBe(brand.color[role].$value!.hex.toUpperCase());
  });
});
