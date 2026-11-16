import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { SOURCE, TARGET, renderTokens } from "../../scripts/sync-brand.mjs";
import { adoptedButPending, PENDING_BRAND_ROLES, pendingAndAbsent } from "../brand-pending";

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
  // Only the roles in PENDING_BRAND_ROLES (test/brand-pending.ts) may be missing.
  it("matches the brand's tokens.json, role for role", () => {
    const brand = JSON.parse(readFileSync(path.join(__dirname, "../../public/art/brand/tokens.json"), "utf8")) as {
      color: Record<string, { $value?: { hex: string } }>;
    };
    const site = (YAML.parse(readFileSync(SOURCE, "utf8")) as { color: Record<string, string> }).color;
    const roles = Object.keys(brand.color).filter((k) => !k.startsWith("$") && !pendingAndAbsent(k, site));
    expect(Object.keys(site).sort()).toEqual(roles.sort());
    for (const role of roles) expect(site[role].toUpperCase(), role).toBe(brand.color[role].$value!.hex.toUpperCase());
  });

  it("lets only real brand roles wait, so the pending list is no blanket pass", () => {
    const brand = JSON.parse(readFileSync(path.join(__dirname, "../../public/art/brand/tokens.json"), "utf8")) as {
      color: Record<string, unknown>;
    };
    for (const role of PENDING_BRAND_ROLES) expect(Object.hasOwn(brand.color, role), role).toBe(true);
    // Known bad: a core role is never pending, so dropping it from the site still fails.
    expect(pendingAndAbsent("ground", {})).toBe(false);
    expect(pendingAndAbsent("region-space-peak", {})).toBe(true);
    expect(pendingAndAbsent("region-space-peak", { "region-space-peak": "#C67273" })).toBe(false);
  });

  // A role leaves the list when the site takes it in (step W0b deletes the
  // file), so the list can never hold a role brand_tokens.yaml declares.
  it("keeps no role on the pending list once brand_tokens.yaml declares it", () => {
    const tokens = YAML.parse(readFileSync(SOURCE, "utf8")) as { color: Record<string, string>; night: Record<string, string> };
    expect(Object.keys(tokens.color).length).toBeGreaterThan(0);
    expect(adoptedButPending(tokens)).toEqual([]);
  });

  it("flags a pending role the site declares, in color or night (known bad), and passes a site that lacks them (known clean)", () => {
    const fix = "remove it from PENDING_BRAND_ROLES in site/test/brand-pending.ts";
    expect(adoptedButPending({ color: { ground: "#FFFFFF", "region-space-peak": "#C67273" } })).toEqual([
      `region-space-peak is declared in 01_doctrine/brand_tokens.yaml: ${fix}`,
    ]);
    expect(adoptedButPending({ color: { ground: "#FFFFFF" }, night: { "on-region-fusion-canyon": "#000A33" } })).toEqual([
      `on-region-fusion-canyon is declared in 01_doctrine/brand_tokens.yaml: ${fix}`,
    ]);
    expect(adoptedButPending({ color: { ground: "#FFFFFF" }, night: { ground: "#000A33" } })).toEqual([]);
  });

  // The night block copies each role's night value from the same tokens.json
  // ($extensions), role for role: no role missing, none extra, no hex drift.
  it("matches the brand's night set, role for role", () => {
    const brand = JSON.parse(readFileSync(path.join(__dirname, "../../public/art/brand/tokens.json"), "utf8")) as {
      color: Record<string, { $extensions?: { "org.coloradostartups.brand"?: { night?: { hex: string } } } }>;
    };
    const tokens = YAML.parse(readFileSync(SOURCE, "utf8")) as { color: Record<string, string>; night: Record<string, string> };
    const night = tokens.night;
    const want = Object.fromEntries(
      Object.entries(brand.color)
        .filter(([k, v]) => !k.startsWith("$") && v.$extensions?.["org.coloradostartups.brand"]?.night && !pendingAndAbsent(k, tokens.color))
        .map(([k, v]) => [k, v.$extensions!["org.coloradostartups.brand"]!.night!.hex.toUpperCase()]),
    );
    expect(Object.keys(want).length).toBeGreaterThan(0);
    expect(Object.fromEntries(Object.entries(night).map(([k, v]) => [k, v.toUpperCase()]))).toEqual(want);
  });

  it("renders the night set for the system setting and for data-theme", () => {
    const css = readFileSync(TARGET, "utf8");
    const media = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}\s*\}/);
    const pinned = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/);
    expect(media, "no system dark block").not.toBeNull();
    expect(pinned, "no data-theme dark block").not.toBeNull();
    const decls = (body: string) => body.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(decls(media![1])).toEqual(decls(pinned![1]));
    expect(media![1]).toContain("color-scheme: dark;");
    expect(media![1]).toContain("--c-ground: #000A33;");
    // The light block stays light.
    expect(css.slice(0, css.indexOf("@media"))).toContain("color-scheme: light;");
  });

  it("refuses a night value for an unknown role", () => {
    expect(() => renderTokens('color: { ground: "#FFFFFF" }\nnight: { nope: "#000000" }\n')).toThrow(/nope/);
  });
});
