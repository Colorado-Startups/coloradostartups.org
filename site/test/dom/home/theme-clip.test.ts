import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DIST_DIR, readDist } from "../pages";

// The Photon Mountain panel's brand clip (brand v4.2.0, ThemePanel.astro): it
// plays over the painting, muted and looped, loads nothing until it nears the
// screen, and leaves the painting as the image and its alt text.
const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
const panel = home.querySelector("#theme-photon-mountain")!.closest("article")!;

describe("home theme clip", () => {
  const video = panel.querySelector<HTMLVideoElement>("video[data-theme-clip]")!;

  it("plays silently and loads nothing up front", () => {
    expect(video).not.toBeNull();
    for (const attr of ["muted", "loop", "playsinline"]) expect(video.hasAttribute(attr), attr).toBe(true);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("autoplay")).toBe(false);
  });

  it("keeps the painting as the image, with its alt text, and hides the clip from assistive tech", () => {
    expect(panel.querySelector("img.theme__art")?.getAttribute("alt")).toBeTruthy();
    expect(video.getAttribute("aria-hidden")).toBe("true");
  });

  it("serves WebM and MP4 from the pulled brand files", () => {
    const sources = [...video.querySelectorAll("source")].map((s) => s.getAttribute("src")!);
    expect(sources).toEqual(["/art/brand/photonics.webm", "/art/brand/photonics.mp4"]);
    for (const src of sources) expect(existsSync(path.join(DIST_DIR, src)), src).toBe(true);
  });

  it("offers a Pause button, and no other panel has a clip yet", () => {
    expect(panel.querySelector("button[data-clip-toggle]")?.textContent?.trim()).toBe("Pause");
    expect(home.querySelectorAll("video[data-theme-clip]")).toHaveLength(1);
  });
});
