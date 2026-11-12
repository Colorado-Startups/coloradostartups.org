import { describe, expect, it } from "vitest";

import { REGION_ART_ALT, type RegionArtId } from "../../../src/components/art/keepers";
import { contentPages } from "../pages";

// #761: dwarf and gnome keepers work in every region scene, so every built
// page that shows one gives that region's alt, which says they are AI agents
// (.claude/rules/ai-disclosure.md). Built HTML from dist/.

const shown = contentPages().flatMap((p) =>
  [...new DOMParser().parseFromString(p.html, "text/html").querySelectorAll<HTMLElement>('[data-art^="regions/"]')].map(
    (fig) => [p.route, fig.dataset.art!.slice("regions/".length) as RegionArtId, fig.querySelector("img")?.getAttribute("alt")] as const,
  ),
);

describe("the region scenes", () => {
  it("appear on /regions/, each region page, /get-involved/ and the seat pages, at least", () => {
    const routes = new Set(shown.map(([route]) => route));
    for (const r of ["/regions/", "/regions/photon-mountain/", "/get-involved/", "/get-involved/space-peak-connector/"]) {
      expect(routes.has(r), r).toBe(true);
    }
    expect(new Set(shown.map(([, id]) => id))).toEqual(new Set(Object.keys(REGION_ART_ALT)));
  });

  it.each(shown)("%s (%s): the alt discloses the keepers as AI agents", (_route, id, alt) => {
    expect(alt).toBe(REGION_ART_ALT[id]);
    expect(alt).toMatch(/the site's AI agents/);
  });
});
