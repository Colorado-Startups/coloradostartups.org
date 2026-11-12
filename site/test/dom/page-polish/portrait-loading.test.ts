// Page polish, #428, over the built site (run `npm run build` first;
// test:content does). The Publicus portrait at the top of /dispatches/ sits
// in the first screen, so it loads eagerly with a high fetch priority, as
// ArtImage does for first-screen art. Every other keeper portrait keeps
// Portrait's default: lazy.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

const doc = (route: string) => new DOMParser().parseFromString(readDist(route), "text/html");

describe("keeper portrait loading (#428)", () => {
  it("loads the Publicus portrait on /dispatches/ eagerly, with a high fetch priority", () => {
    const img = doc("dispatches/index.html").querySelector("main [data-portrait='publicus'] img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
    expect(img?.getAttribute("alt")).toContain("AI agent");
  });

  it("keeps the keeper portraits on /team/ lazy, with no raised priority", () => {
    const imgs = [...doc("team/index.html").querySelectorAll("main [data-portrait] img")];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("fetchpriority")).not.toBe("high");
    }
  });
});
