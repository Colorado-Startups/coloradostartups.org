// Post-launch item 12: the region labels read the seat's role from its title
// in positions.yaml, so they say "Connector" (decision 67) and never drift.
import { describe, expect, it } from "vitest";

import { seatRole } from "../../../src/lib/regions/page";

describe("seatRole", () => {
  it("takes the role word after the region's name", () => {
    expect(seatRole({ title: "Photon Mountain Connector" }, "Photon Mountain")).toBe("Connector");
    expect(seatRole({ title: "Space Peak Connector" }, "Space Peak")).toBe("Connector");
  });

  it("returns the whole title when it does not start with the region's name", () => {
    expect(seatRole({ title: "Community organizer, statewide" }, "Fusion Canyon")).toBe("Community organizer, statewide");
  });

  it("needs the space after the name, so a longer name is not clipped", () => {
    expect(seatRole({ title: "Space Peaks Connector" }, "Space Peak")).toBe("Space Peaks Connector");
  });
});
