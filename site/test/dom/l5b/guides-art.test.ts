import { describe, expect, it } from "vitest";

import { PLACE_ART_ALT } from "../../../src/components/art/keepers";
import { guideArt, GUIDES_SCENE } from "../../../src/components/guides/guide-art";
import { GUIDE_SLUGS } from "../../../src/lib/guides/core";
import { readDist } from "../pages";

// L5b: every guide shows one picture under its answer, lazily, since it is
// below the first screen. The index, the topic guides and the credits guide
// show L6's guides scene (#713), which has no keeper. Each city guide shows
// its own city's brand v3 place painting, with the brand caption as alt.
// Built HTML from dist/.

const PAGES = [
  ...GUIDE_SLUGS.map((slug) => [`guides/${slug}/index.html`, guideArt(slug)] as const),
  ["guides/index.html", GUIDES_SCENE] as const,
  ["guides/startup-credits/index.html", GUIDES_SCENE] as const,
];

describe.each(PAGES)("%s", (file, art) => {
  it("shows its picture in the first section, after the answer, lazily", () => {
    const main = new DOMParser().parseFromString(readDist(file), "text/html").querySelector("main")!;
    const figures = [...main.querySelectorAll<HTMLElement>("figure.guide-art")];
    expect(figures).toHaveLength(1);
    const [figure] = figures;
    expect(figure!.dataset.art).toBe(art.src);
    expect(figure!.closest("section")).toBe(main.querySelector("section"));
    const img = figure!.querySelector("img");
    expect(img, "the art file exists, so no placeholder").not.toBeNull();
    expect(img!.getAttribute("alt")).toBe(art.alt);
    expect(img!.getAttribute("loading")).toBe("lazy");
    const answer = main.querySelector("[data-guide-answer]")!;
    expect(answer.compareDocumentPosition(figure!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the city guides", () => {
  const cities = {
    "startups-in-denver": "denver",
    "startups-in-boulder": "boulder",
    "startups-in-colorado-springs": "springs",
    "startups-in-fort-collins": "fortcollins",
  } as const;

  it.each(Object.entries(cities))("%s shows the %s place painting, with the brand caption as alt", (slug, place) => {
    const art = guideArt(slug as keyof typeof cities);
    expect(art.src).toBe(`brand/${place}`);
    expect(art.alt).toBe(PLACE_ART_ALT[place]);
  });

  it("are the only guides that show a place painting", () => {
    const placed = GUIDE_SLUGS.filter((slug) => guideArt(slug).src.startsWith("brand/"));
    expect(placed.sort()).toEqual(Object.keys(cities).sort());
  });
});
