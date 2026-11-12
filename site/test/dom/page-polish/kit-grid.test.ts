// Page polish, #243, over the built site (run `npm run build` first;
// test:content does). The two badge panels on /leaderboard/kit/ are the only
// items of one grid, Leaderboard first, so they sit side by side on wide
// screens and keep their order when they stack. The grid's CSS is checked in
// test/unit/page-polish/kit-grid.test.ts.
import { describe, expect, it } from "vitest";

import { KIT_BADGES } from "../../../src/components/kit/badges";
import { readDist } from "../pages";

const page = new DOMParser().parseFromString(readDist("leaderboard/kit/index.html"), "text/html");

describe("/leaderboard/kit/ badge grid (#243)", () => {
  // BadgeCard's copy script renders after the first panel. A script is never
  // displayed, so it takes no grid track.
  it("holds both badge panels, in badges.ts order, and no other shown item", () => {
    const grid = page.querySelector("[data-kit-grid]");
    expect(grid?.classList.contains("kit-grid")).toBe(true);
    const shown = [...(grid?.children ?? [])].filter((el) => el.tagName !== "SCRIPT");
    const items = shown.map((el) => el.getAttribute("data-kit-badge"));
    expect(items).toEqual(KIT_BADGES.map((b) => b.id));
  });
});
