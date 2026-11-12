import { describe, expect, it } from "vitest";

import { REGION_ART_ALT, regionArtAlt } from "../../../src/components/art/keepers";

// #761 review: a region scene's alt comes from REGION_ART_ALT, and a region
// with no entry throws, so no page renders a scene with an empty alt.

describe("regionArtAlt", () => {
  it("returns each region's disclosed alt", () => {
    for (const [id, alt] of Object.entries(REGION_ART_ALT)) {
      expect(regionArtAlt(id)).toBe(alt);
      expect(alt).toMatch(/the site's AI agents/);
    }
  });

  it("throws for a region with no alt", () => {
    expect(() => regionArtAlt("new-region")).toThrow(/no REGION_ART_ALT entry for region "new-region"/);
  });
});
