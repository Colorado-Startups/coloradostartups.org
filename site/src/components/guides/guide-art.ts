// The picture under each guide's answer. The index, the topic guides and the
// startup credits guide show L6's guides scene and its alt text (2026-11-04,
// art/finals.json); no keeper is in it. Each city guide shows its own city's
// brand v3 place painting (brand/<place>) with the brand's caption as alt
// (PLACE_ART_ALT). All are 16:9 boxes below the first screen, so they load lazily.
import type { GuideSlug } from "../../lib/guides/core";
import { PLACE_ART_ALT } from "../art/keepers";

export interface GuideArt {
  /** Asset key under src/assets/art. */
  src: string;
  alt: string;
}

export const GUIDES_SCENE: GuideArt = {
  src: "scenes/guides",
  alt: "Two founders mark a hand-drawn map of the Front Range beside a copper rocket and a satellite, with snowy peaks above the Denver skyline through the window.",
};

// Each city guide's own place painting (Colorado-Startups/brand dist/places).
const CITY_PLACE: Partial<Record<GuideSlug, keyof typeof PLACE_ART_ALT>> = {
  "startups-in-denver": "denver",
  "startups-in-boulder": "boulder",
  "startups-in-colorado-springs": "springs",
  "startups-in-fort-collins": "fortcollins",
};

/** The picture for one guide: its city's place painting, or the guides scene. */
export function guideArt(slug: GuideSlug): GuideArt {
  const place = CITY_PLACE[slug];
  return place ? { src: `brand/${place}`, alt: PLACE_ART_ALT[place] } : GUIDES_SCENE;
}

/** ArtImage settings shared by every guide page: under the answer, at most 40rem wide. */
export const GUIDE_ART_IMAGE: { aspect: string; widths: number[]; sizes: string } = {
  aspect: "16 / 9",
  widths: [640, 960, 1280],
  sizes: "(min-width: 44rem) 40rem, calc(100vw - 48px)",
};
