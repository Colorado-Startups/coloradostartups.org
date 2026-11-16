import { describe, expect, it } from "vitest";

import { brandArt } from "../../../src/components/art/art-assets";
import { PLACE_ART_ALT } from "../../../src/components/art/keepers";
import { guideArt, GUIDES_SCENE } from "../../../src/components/guides/guide-art";
import { GUIDE_SLUGS } from "../../../src/lib/guides/core";
import { readDist } from "../pages";

// L5b: every guide page shows one picture, lazily. The index, the topic
// guides and the credits guide show the brand's guides scene (brand/guides),
// which has no keeper. Each city guide shows its own city's brand place
// painting, with the brand caption as alt. A topic or city guide shows it in
// the first section after its answer chart, so the chart is the first
// picture. The index and the credits guide lead with their content (Paul,
// 2026-11-16: "they're supposed to be getting info"): their first section
// holds no painting, and the scene closes the page.
// Built HTML from dist/.

const parse = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html").querySelector("main")!;
const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;

/** The page's one guide picture, checked for its key, alt and lazy load. */
function onePicture(main: Element, art: { src: string; alt: string }): HTMLElement {
  const figures = [...main.querySelectorAll<HTMLElement>("figure.guide-art")];
  expect(figures).toHaveLength(1);
  const figure = figures[0]!;
  expect(figure.dataset.art).toBe(art.src);
  const img = figure.querySelector("img");
  expect(img, "the art file exists, so no placeholder").not.toBeNull();
  expect(img!.getAttribute("alt")).toBe(art.alt);
  expect(img!.getAttribute("loading")).toBe("lazy");
  return figure;
}

describe.each(GUIDE_SLUGS.map((slug) => [`guides/${slug}/index.html`, guideArt(slug)] as const))("%s", (file, art) => {
  it("shows its picture in the first section, after the answer and its chart, lazily", () => {
    const main = parse(file);
    const figure = onePicture(main, art);
    expect(figure.closest("section")).toBe(main.querySelector("section"));
    const answer = main.querySelector("[data-guide-answer]")!;
    expect(answer.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
    const chart = main.querySelector("[data-guide-diagram]")!;
    expect(chart.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
  });
});

describe.each([
  ["guides/index.html", "else-title"],
  ["guides/startup-credits/index.html", "about-title"],
] as const)("%s", (file, lastHeading) => {
  it("keeps its first section free of the painting, and closes the page with it, lazily", () => {
    const main = parse(file);
    const figure = onePicture(main, GUIDES_SCENE);
    const first = main.querySelector("section")!;
    expect(first.querySelector("[data-art]")).toBeNull();
    const sections = [...main.querySelectorAll("section")];
    expect(figure.closest("section")).toBe(sections.at(-1));
    expect(figure.closest("section")?.querySelector(`#${lastHeading}`)).not.toBeNull();
    const answer = main.querySelector("[data-guide-answer]")!;
    expect(answer.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
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
    const placed = GUIDE_SLUGS.filter((slug) => guideArt(slug).src !== GUIDES_SCENE.src);
    expect(placed.sort()).toEqual(Object.keys(cities).sort());
  });
});

describe("the guides scene", () => {
  it("is the pulled brand file, so the page serves it as-is", () => {
    expect(GUIDES_SCENE.src).toBe("brand/guides");
    expect(brandArt(GUIDES_SCENE.src)).toBeDefined();
  });
});
