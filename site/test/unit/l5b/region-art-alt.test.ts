import { describe, expect, it } from "vitest";

import { REGION_ART_ALT, regionArtAlt } from "../../../src/components/art/keepers";

// A region picture's alt comes from REGION_ART_ALT (the brand's captions), and
// a region with no entry throws, so no page renders a picture with an empty alt.

describe("regionArtAlt", () => {
  it("returns each region's alt", () => {
    for (const [id, alt] of Object.entries(REGION_ART_ALT)) {
      expect(regionArtAlt(id)).toBe(alt);
      expect(alt.length).toBeGreaterThan(20);
    }
  });

  it("throws for a region with no alt", () => {
    expect(() => regionArtAlt("new-region")).toThrow(/no REGION_ART_ALT entry for region "new-region"/);
  });
});
