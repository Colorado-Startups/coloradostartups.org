import { existsSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { DIST_DIR, readDist } from "../pages";

// Photon Mountain's brand clip (RegionArt.astro; brand v4.2.0, and every
// region has one since v4.3.0): it plays over the region page's painting, muted and looped, loads nothing until it
// nears the screen, and leaves the painting as the image and its alt text.
// Since step R1 the painting sits further down the page, after the honorees.
// The home page's Why Colorado panels carry maps, not paintings, so no clip.
const page = new DOMParser().parseFromString(readDist("regions/photon-mountain/index.html"), "text/html");
const media = page.querySelector(".region-art__media")!;

describe("Photon Mountain's hero clip", () => {
  const video = media.querySelector<HTMLVideoElement>("video[data-region-clip]")!;

  it("plays silently and loads nothing up front", () => {
    expect(video).not.toBeNull();
    for (const attr of ["muted", "loop", "playsinline"]) expect(video.hasAttribute(attr), attr).toBe(true);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("autoplay")).toBe(false);
    // No poster or src to fetch either: the still under it is a lazy <img>.
    expect(video.hasAttribute("poster")).toBe(false);
    expect(video.hasAttribute("src")).toBe(false);
    expect(media.querySelector(".region-art--hero img")?.getAttribute("loading")).toBe("lazy");
  });

  // Step R1: the map leads; the painting and its clip are an extra further down.
  it("sits outside the first section, after the honorees", () => {
    const sections = [...page.querySelectorAll("main section")];
    const at = sections.indexOf(video.closest("section")!);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(sections.findIndex((s) => s.querySelector("[data-region-honorees]")));
  });

  it("keeps the painting as the image, with its alt text, and hides the clip from assistive tech", () => {
    expect(media.querySelector(".region-art--hero img")?.getAttribute("alt")).toBeTruthy();
    expect(video.getAttribute("aria-hidden")).toBe("true");
  });

  it("serves WebM and MP4 from the pulled brand files", () => {
    const sources = [...video.querySelectorAll("source")].map((s) => s.getAttribute("src")!);
    expect(sources).toEqual(["/art/brand/photonics.webm", "/art/brand/photonics.mp4"]);
    for (const src of sources) expect(existsSync(path.join(DIST_DIR, src)), src).toBe(true);
  });

  it("offers a Pause button on every region page, and the home page has no clip", () => {
    // Space Peak and Fusion Canyon got their clips in brand v4.3.0 (brand-v43.test.ts).
    for (const id of REGION_IDS) {
      const region = new DOMParser().parseFromString(readDist(`regions/${id}/index.html`), "text/html");
      const toggle = region.querySelector(".region-art__media button[data-clip-toggle]");
      expect(toggle?.getAttribute("type"), id).toBe("button");
      expect(toggle?.textContent?.trim(), id).toBe("Pause");
    }
    expect(readDist("index.html")).not.toContain("data-region-clip");
  });
});
