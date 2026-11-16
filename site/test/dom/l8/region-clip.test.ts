import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DIST_DIR, readDist } from "../pages";

// Photon Mountain's brand clip (brand v4.2.0, RegionArt.astro): it plays over
// the region page's hero painting, muted and looped, loads nothing until it
// nears the screen, and leaves the painting as the image and its alt text.
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

  it("offers a Pause button, and the home page has no clip", () => {
    expect(media.querySelector("button[data-clip-toggle]")?.textContent?.trim()).toBe("Pause");
    // Space Peak and Fusion Canyon got their clips in brand v4.3.0 (brand-v43.test.ts).
    expect(readDist("index.html")).not.toContain("data-region-clip");
  });
});
