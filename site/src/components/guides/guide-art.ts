// The picture on each guide page. The index, the topic guides and the
// startup credits guide show the brand's guides scene (brand/guides, from
// brand v4.0.0 dist/website/guides.jpg, viewed 2026-11-15); no keeper is in
// it. Each city guide shows its own city's brand place painting
// (brand/<place>) with the brand's caption as alt (PLACE_ART_ALT). A topic
// or city guide shows it after its answer chart, so the chart is the page's
// first picture; the index and the credits guide close the page with it
// (2026-11-16). All are 16:9 boxes that load lazily.
import type { GuideSlug } from "../../lib/guides/core";
import { PLACE_ART_ALT } from "../art/keepers";

export interface GuideArt {
  /** Art key for ArtImage: brand/<name>, a pulled brand file (art-assets.ts brandArt). */
  src: string;
  alt: string;
}

export const GUIDES_SCENE: GuideArt = {
  src: "brand/guides",
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
