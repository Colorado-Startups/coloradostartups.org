import { describe, expect, it } from "vitest";

import { SECTORS } from "../../../src/lib/leaderboard/sectors";
import { OTHER_THEME, THEMES, themeCounts, themeOf } from "../../../src/lib/leaderboard/themes";

// L2: the Leaderboard's theme chips (the redesign, 2026-11-15). Three Why
// Colorado themes, each one sector, and everything else.

describe("themeOf", () => {
  it("puts each theme sector in its theme and every other sector in Everything else", () => {
    expect(themeOf("Quantum and photonics")).toBe("photonics");
    expect(themeOf("Energy and climate")).toBe("energy");
    expect(themeOf("Space and aerospace")).toBe("space");
    expect(themeOf("Software")).toBe(OTHER_THEME);
    expect(themeOf("Not a sector")).toBe(OTHER_THEME);
  });

  it("maps exactly three sectors to named themes", () => {
    expect(SECTORS.filter((s) => themeOf(s) !== OTHER_THEME)).toHaveLength(3);
  });
});

describe("THEMES", () => {
  it("lists the three themes in the home page's order, then Everything else with no color", () => {
    expect(THEMES.map((t) => t.label)).toEqual([
      "Photonics and quantum",
      "Energy and climate",
      "Space and aerospace",
      "Everything else",
    ]);
    expect(THEMES.slice(0, 3).every((t) => t.color?.startsWith("var(--c-"))).toBe(true);
    expect(THEMES[3]!.color).toBeNull();
  });
});

describe("themeCounts", () => {
  it("counts each theme, and the counts add up to every row", () => {
    const sectors = ["Software", "Space and aerospace", "Space and aerospace", "Energy and climate", "Health care"];
    const counts = themeCounts(sectors);
    expect(counts.map((t) => [t.id, t.count])).toEqual([
      ["photonics", 0],
      ["energy", 1],
      ["space", 2],
      [OTHER_THEME, 2],
    ]);
    expect(counts.reduce((n, t) => n + t.count, 0)).toBe(sectors.length);
  });
});
