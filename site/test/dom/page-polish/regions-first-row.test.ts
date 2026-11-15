import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// #258 for the regions: only an image in the first screen loads eagerly, at
// high priority. Since step H (2026-11-15) the first screen of /regions/ is
// the map, drawn inline, so no image in its main loads eagerly; the theme
// panels' paintings below it wait. A region page's first screen is its
// painting, so the hero alone loads eagerly (review of #511).

const page = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");

describe("first-screen image loading on the regions", () => {
  it("/regions/: the map leads, drawn inline, and every painting in main waits", () => {
    const main = page("regions/index.html").querySelector("main")!;
    expect(main.querySelector("#regions-map .colorado-map__drawing svg")).not.toBeNull();
    const imgs = [...main.querySelectorAll("img")];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("loading"), img.getAttribute("src") ?? "").toBe("lazy");
      expect(img.getAttribute("fetchpriority")).not.toBe("high");
    }
  });

  it.each(REGION_IDS)("/regions/%s/: the hero painting alone loads eagerly, at high priority", (id) => {
    const main = page(`regions/${id}/index.html`).querySelector("main")!;
    const eager = [...main.querySelectorAll("img")].filter((img) => img.getAttribute("loading") !== "lazy");
    expect(eager).toHaveLength(1);
    expect(eager[0]!.closest(".region-art--hero")).not.toBeNull();
    expect(eager[0]!.getAttribute("fetchpriority")).toBe("high");
  });
});
