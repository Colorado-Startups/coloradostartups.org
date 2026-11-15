// The home page's figures and counts, read at build time.
//
// THEMES: the three Why Colorado panels. Each tile is one fact from
// data/positions/facts.yaml, shown with that fact's value and source line
// (`short`); factById() stops the build if an id goes missing, so the page can
// never show an unsourced figure. The tile labels are shortened from each
// fact's own label and keep its meaning.
//
// homeCounts(): the four Explore tiles, counted from the same data the pages
// and /data/*.json use, so the numbers never drift from the pages they open.
import { getCollection } from "astro:content";

import type { RegionId } from "@cs/shared";

import { GUIDE_SLUGS } from "../../lib/guides/guides";
import { buildBoard, latestEdition } from "../../lib/leaderboard/board";
import { factById, loadFacts } from "../../lib/seats/load";
import { activeCards } from "../canvas/canvas-data";
import { SNAPSHOT, upcomingEvents } from "../events/events";

export interface StatTileData {
  value: string;
  label: string;
  source: string;
}

export interface Theme {
  title: string;
  region: RegionId;
  regionName: string;
  /** A brand place painting (brand/<place>). */
  place: "boulder" | "fortcollins" | "springs";
  tiles: StatTileData[];
  /** How many 2026 Leaderboard honorees work in this theme. */
  honorees: string;
  /** A brand clip (brand/<clip>.webm and .mp4) that plays over the painting, when the brand has one. */
  clip?: "photonics";
}

const SPEC = [
  {
    title: "Photonics & quantum",
    region: "photon-mountain",
    regionName: "Photon Mountain",
    place: "boulder",
    tiles: [
      ["elevate-quantum-eda-award", "federal Tech Hub award to Elevate Quantum"],
      ["cu-physics-nobel-laureates", "Nobel laureates in CU Boulder physics"],
      ["cpia-photonics-companies", "photonics companies in Colorado"],
    ],
    honorees: "honorees-quantum-photonics",
    clip: "photonics",
  },
  {
    title: "Fusion & energy",
    region: "fusion-canyon",
    regionName: "Fusion Canyon",
    place: "fortcollins",
    tiles: [
      ["csu-atlas-facility", "for ATLAS, CSU's laser facility with Marvel Fusion"],
      ["xcimer-raised", "raised by Xcimer Energy for laser fusion"],
      ["co-wind-share-2024", "of Colorado's electricity came from wind in 2024"],
    ],
    honorees: "honorees-energy-climate",
  },
  {
    title: "Space",
    region: "space-peak",
    regionName: "Space Peak",
    place: "springs",
    tiles: [
      ["guardians-in-colorado", "of all uniformed Space Force Guardians are in Colorado"],
      ["co-aerospace-jobs-edc", "private jobs in Colorado's aerospace cluster, an economic development group's estimate"],
      ["nasa-co-procurement-fy2023", "in NASA purchasing from Colorado"],
    ],
    honorees: "honorees-space-aerospace",
  },
] as const;

export function themes(): Theme[] {
  const facts = loadFacts();
  return SPEC.map((t) => ({
    title: t.title,
    region: t.region,
    regionName: t.regionName,
    place: t.place,
    tiles: t.tiles.map(([id, label]) => {
      const fact = factById(facts, id);
      return { value: String(fact.value), label, source: fact.short };
    }),
    honorees: String(factById(facts, t.honorees).value),
    clip: "clip" in t ? t.clip : undefined,
  }));
}

export interface HomeCounts {
  resources: number;
  companies: number;
  events: number;
  guides: number;
}

export async function homeCounts(now = new Date()): Promise<HomeCounts> {
  const companies = (await getCollection("companies")).map((e) => e.data);
  const edition = latestEdition((await getCollection("editions")).map((e) => e.data));
  return {
    resources: (await activeCards()).length,
    companies: edition ? buildBoard(edition, companies).length : 0,
    events: upcomingEvents(SNAPSHOT, now).length,
    // The topic and city guides, plus the startup credits guide.
    guides: GUIDE_SLUGS.length + 1,
  };
}
