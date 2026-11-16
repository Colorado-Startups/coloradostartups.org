// One color per region, shared by the maps, the region chips and the panels.
// The Front Range dot map that lived here left /regions/ when the statewide
// map (components/map/ColoradoMap.astro) took its place; only the colors stay.

import type { RegionId } from "@cs/shared";

// One color per region, from the brand tokens (brand v3: deep State Yellow,
// Teal and State Red). Against the white ground, Teal is 6.41:1 and Red 6.25:1;
// deep Yellow is 1.91:1, under the 3:1 mark target, so a map names every region
// and city in text as well (WCAG ratios from the tokens, 2026-11-15). Recheck
// these if the tokens change.
export const REGION_COLORS: Readonly<Record<RegionId, string>> = {
  "photon-mountain": "var(--c-accent-deep)",
  "space-peak": "var(--c-community)",
  // Fire, not link: the night theme turns links gold, the same as Photon Mountain.
  "fusion-canyon": "var(--c-fire)",
};
