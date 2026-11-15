// The four figures at the top of each region page, read at build time. Each
// tile is one fact from data/positions/facts.yaml, shown with that fact's
// value and source line (`short`), as the home page's Why Colorado panels do
// (home/home-data.ts). factById() stops the build if an id goes missing, so a
// region page can never show an unsourced figure. Each label is shortened from
// the fact's own label and keeps its meaning. Every fact is about the region:
// its people, its research and its anchors. The home page's statewide theme
// figures are not repeated here.
import type { RegionId } from "@cs/shared";

import { factById, loadFacts } from "../../lib/seats/load";
import type { StatTileData } from "../home/home-data";

export const REGION_TILES: Record<RegionId, readonly (readonly [factId: string, label: string])[]> = {
  "photon-mountain": [
    ["pop-denver-metro", "people in the Denver-Aurora-Centennial metro area"],
    ["denver-boulder-ecosystem-value", "Denver-Boulder startup ecosystem value, mid-2023 to 2025"],
    ["cu-boulder-startups", "startups spun out of CU Boulder technology"],
    ["quantum-commons-acres", "acres for the Quantum Commons, a campus for quantum companies in Arvada"],
  ],
  "fusion-canyon": [
    ["noco-population", "people in Larimer and Weld counties"],
    ["csu-ife-hub", "national inertial fusion energy hubs the Energy Department funded in 2023 is led by CSU"],
    ["csu-research", "in sponsored research spending at CSU"],
    ["csu-enrollment", "students at CSU in Fort Collins, a record"],
  ],
  "space-peak": [
    ["space-peak-metro-pop", "people in the Colorado Springs metro area"],
    ["peterson-personnel-fy2025", "military and civilian personnel at Peterson Space Force Base"],
    ["schriever-staff", "military and civilian staff at Schriever Space Force Base"],
    ["usafa-cadets", "cadets at the US Air Force Academy"],
  ],
};

/** A region's tiles, each with its fact's value and source line. */
export function regionTiles(region: RegionId): StatTileData[] {
  const facts = loadFacts();
  return REGION_TILES[region].map(([id, label]) => {
    const fact = factById(facts, id);
    return { value: String(fact.value), label, source: fact.short };
  });
}
