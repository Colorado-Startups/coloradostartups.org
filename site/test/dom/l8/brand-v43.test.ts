import { existsSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { REGION_CLIP } from "../../../src/components/art/keepers";
import { DIST_DIR, readDist } from "../pages";

// Brand v4.3.0 (#59): every region now has a clip over its painting and a
// crest on its chip. The brand's dist/README.md pairs fusion with Fort Collins
// and space with Colorado Springs, and asks for crests at 32 px and up.
const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");
const WANT_CLIP = { "photon-mountain": "photonics", "space-peak": "space", "fusion-canyon": "fusion" };

describe("brand v4.3.0 clips", () => {
  it("gives all 3 regions a clip, each on the painting the brand pairs it with", () => {
    expect(REGION_CLIP).toEqual(WANT_CLIP);
  });

  it("plays each region's clip on its page, muted, paused for assistive tech, from pulled files", () => {
    const clips = REGION_IDS.map((id) => {
      const video = doc(`regions/${id}/index.html`).querySelector<HTMLVideoElement>(".region-art__media video[data-region-clip]");
      expect(video, id).not.toBeNull();
      expect(video!.hasAttribute("muted"), id).toBe(true);
      expect(video!.getAttribute("aria-hidden"), id).toBe("true");
      const sources = [...video!.querySelectorAll("source")].map((s) => s.getAttribute("src")!);
      const name = WANT_CLIP[id];
      expect(sources, id).toEqual([`/art/brand/${name}.webm`, `/art/brand/${name}.mp4`]);
      for (const src of sources) expect(existsSync(path.join(DIST_DIR, src)), src).toBe(true);
      return name;
    });
    expect(new Set(clips).size).toBe(3);
  });
});

describe("brand v4.3.0 crests", () => {
  it("shows 3 crests on /regions/, each 32 px or larger with alt text naming its region", () => {
    const page = doc("regions/index.html");
    const crests = REGION_IDS.map((id) => {
      const img = page.querySelector<HTMLImageElement>(`.region-chips [data-region='${id}'] img.region-chip__crest`);
      expect(img, id).not.toBeNull();
      expect(Number(img!.getAttribute("width")), id).toBeGreaterThanOrEqual(32);
      expect(Number(img!.getAttribute("height")), id).toBeGreaterThanOrEqual(32);
      expect(img!.getAttribute("alt"), id).toMatch(/crest/);
      const name = page.querySelector(`.region-chips [data-region='${id}'] .region-chip__name`)?.textContent?.trim();
      expect(img!.getAttribute("alt"), id).toContain(name);
      const src = img!.getAttribute("src")!;
      expect(src, id).toBe(`/art/brand/${id}-512-512.webp`);
      expect(existsSync(path.join(DIST_DIR, src)), src).toBe(true);
      return img!.getAttribute("alt");
    });
    expect(new Set(crests).size).toBe(3);
  });
});
