import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// The home page's maps (ColoradoMap.astro): the statewide map as a drawing over
// its relief image, and each Why Colorado panel's header, the real map of its
// region as one link to the region's page. No live map and no MapLibre here.
const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");

describe("home maps", () => {
  it("draws the statewide map over its relief, with a link on each zone", () => {
    const map = home.querySelector("figure#home-map")!;
    expect(map.querySelector("img.colorado-map__relief")?.getAttribute("loading")).toBe("lazy");
    expect(map.querySelector(".colorado-map__drawing svg[role='img']")).not.toBeNull();
    expect(map.hasAttribute("data-colorado-map"), "no live map on the home page").toBe(false);
    const hits = [...map.querySelectorAll<HTMLAnchorElement>("a.colorado-map__hit")];
    expect(hits.map((a) => a.getAttribute("href")).sort()).toEqual(REGION_IDS.map((id) => `/regions/${id}/`).sort());
    // The region links beside the map say the same, so these stay out of the tab order.
    for (const a of hits) {
      expect(a.getAttribute("tabindex")).toBe("-1");
      expect(a.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it.each(REGION_IDS)("heads the %s panel with its real map, linked to its page", (id) => {
    const panel = home.querySelector(`#theme-${id}`)!.closest("article")!;
    const link = panel.querySelector<HTMLAnchorElement>("a.colorado-map--thumb")!;
    expect(link.getAttribute("href")).toBe(`/regions/${id}/`);
    const svg = link.querySelector("svg[role='img']")!;
    expect(svg.getAttribute("aria-label")).toMatch(/^Map of /);
    expect(svg.getAttribute("viewBox")).toBe("0 0 384 216");
    const relief = link.querySelector<HTMLImageElement>("img.colorado-map__relief")!;
    expect(relief.getAttribute("alt")).toBe("");
    expect(relief.getAttribute("loading")).toBe("lazy");
    // The painting is the region page's full art now, not the card's header.
    expect(panel.querySelector("img.theme__art")).toBeNull();
  });
});
