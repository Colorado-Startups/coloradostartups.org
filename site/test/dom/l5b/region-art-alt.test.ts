import { describe, expect, it } from "vitest";

import { PLACE_ART_ALT } from "../../../src/components/art/keepers";
import { contentPages } from "../pages";

// Brand v3: every built page that shows a place painting (brand/<place>) gives
// that place's alt, the brand's own plain caption (keepers.ts PLACE_ART_ALT).
// The crowds in them are community folk, not the keepers. Built HTML from dist/.

type Place = keyof typeof PLACE_ART_ALT;

const isPlace = (name: string): name is Place => Object.hasOwn(PLACE_ART_ALT, name);

// Only the place paintings: the brand's hall scenes (brand/passage,
// brand/founders) carry their own alts, checked in page-polish/founders-404.test.ts.
const shown = contentPages().flatMap((p) =>
  [...new DOMParser().parseFromString(p.html, "text/html").querySelectorAll<HTMLElement>('[data-art^="brand/"]')]
    .map((fig) => [p.route, fig.dataset.art!.slice("brand/".length), fig.querySelector("img")?.getAttribute("alt")] as const)
    .filter((row): row is readonly [string, Place, string | null | undefined] => isPlace(row[1])),
);

describe("the brand place paintings", () => {
  it("appear on each region page, /get-involved/ and the seat pages, at least", () => {
    const routes = new Set(shown.map(([route]) => route));
    for (const r of ["/regions/photon-mountain/", "/regions/fusion-canyon/", "/regions/space-peak/", "/get-involved/", "/get-involved/space-peak-connector/"]) {
      expect(routes.has(r), r).toBe(true);
    }
    for (const place of ["boulder", "springs", "fortcollins", "golden"] as const) {
      expect(shown.some(([, p]) => p === place), place).toBe(true);
    }
  });

  it.each(shown)("%s (%s): the alt is the brand's caption", (_route, place, alt) => {
    expect(alt).toBe(PLACE_ART_ALT[place]);
  });
});
