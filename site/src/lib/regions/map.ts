// One color per region, shared by the maps, the region chips and the panels.
// The Front Range dot map that lived here left /regions/ when the statewide
// map (components/map/ColoradoMap.astro) took its place; only the colors stay.

import type { RegionId } from "@cs/shared";

// Each region's fill from the brand's crest tokens (brand v4.4.0, decision 64):
// the custom property 01_doctrine/brand_tokens.yaml generates, with its night
// value in the dark theme. A region color is a fill, never text, and the
// region's name rides beside it; text set on the fill takes --c-on-region-<id>.
// On ground and surface every fill meets the 3:1 a shape needs (brand_tokens.yaml
// contrast block; Space Peak is the lowest, 3.15:1 on surface).
export const REGION_TOKENS: Readonly<Record<RegionId, `--c-region-${RegionId}`>> = {
  "photon-mountain": "--c-region-photon-mountain",
  "space-peak": "--c-region-space-peak",
  "fusion-canyon": "--c-region-fusion-canyon",
};

// The same colors as CSS values, for a style attribute, an SVG fill or a
// stroke. map-file.ts resolves them to hex for the standalone SVG files.
export const REGION_COLORS: Readonly<Record<RegionId, string>> = {
  "photon-mountain": `var(${REGION_TOKENS["photon-mountain"]})`,
  "space-peak": `var(${REGION_TOKENS["space-peak"]})`,
  "fusion-canyon": `var(${REGION_TOKENS["fusion-canyon"]})`,
};
