// The picture under each guide's answer. The index, the topic guides and the
// startup credits guide show L6's guides scene and its alt text (2026-11-04,
// art/finals.json); no keeper is in it. Each city guide shows its region's
// scene, whose keepers its alt names as AI agents (REGION_ART_ALT, #761).
// All are 16:9 and sit below the first screen, so they load lazily.
import type { GuideSlug } from "../../lib/guides/core";
import { regionArtAlt } from "../art/keepers";

export interface GuideArt {
  /** Asset key under src/assets/art. */
  src: string;
  alt: string;
}

export const GUIDES_SCENE: GuideArt = {
  src: "scenes/guides",
  alt: "Two founders mark a hand-drawn map of the Front Range beside a copper rocket and a satellite, with snowy peaks above the Denver skyline through the window.",
};

// Each city guide's region, as the region pages group the cities.
const CITY_REGION: Partial<Record<GuideSlug, string>> = {
  "startups-in-denver": "photon-mountain",
  "startups-in-boulder": "photon-mountain",
  "startups-in-colorado-springs": "space-peak",
  "startups-in-fort-collins": "fusion-canyon",
};

/** The picture for one guide: its city's region scene, or the guides scene. */
export function guideArt(slug: GuideSlug): GuideArt {
  const region = CITY_REGION[slug];
  return region ? { src: `regions/${region}`, alt: regionArtAlt(region) } : GUIDES_SCENE;
}

/** ArtImage settings shared by every guide page: under the answer, at most 40rem wide. */
export const GUIDE_ART_IMAGE: { aspect: string; widths: number[]; sizes: string } = {
  aspect: "16 / 9",
  widths: [640, 960, 1280],
  sizes: "(min-width: 44rem) 40rem, calc(100vw - 48px)",
};
