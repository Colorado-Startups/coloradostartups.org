import { describe, expect, it } from "vitest";

import { HALL_ART_ALT } from "../../../src/components/art/keepers";
import { readDist } from "../pages";

// L5b (#239): the Leaderboard's title is carved in a lintel. The page leads
// with Colorado (Paul, 2026-11-16): the first section holds no picture, so
// the HQ map is the page's first picture, and the Hall picture (brand/golden,
// the brand caption as alt) closes the page in the nominate hearth, lazily.
// Built HTML from dist/.

const doc = new DOMParser().parseFromString(readDist("leaderboard/index.html"), "text/html");
const main = doc.querySelector("main")!;
const hero = doc.querySelector("main > section")!;
const PICTURE = "img, svg[role='img'], [role='img'], video, canvas";

describe("/leaderboard/ hero", () => {
  it("carves the one h1 in a lintel banner", () => {
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    const h1 = hero.querySelector(".hall-banner--lintel h1");
    expect(h1?.textContent?.trim()).toBe("The Leaderboard");
  });

  it("holds no picture, so the words and the actions lead", () => {
    expect(hero.querySelectorAll(PICTURE)).toHaveLength(0);
    expect(hero.querySelector("[data-art], [data-portrait]")).toBeNull();
  });

  it("keeps the nominate action in the hero", () => {
    expect(hero.querySelector('a.btn--gold[href="/leaderboard/nominate/"]')).not.toBeNull();
  });
});

describe("/leaderboard/ pictures", () => {
  it("shows the HQ map first", () => {
    const first = main.querySelector(PICTURE);
    expect(first?.closest("figure.chart")?.querySelector("#chart-map-title")).not.toBeNull();
  });

  it("closes the page with the Hall picture in the nominate hearth, lazily, the brand caption as alt", () => {
    const seals = [...main.querySelectorAll<HTMLElement>('[data-art="brand/golden"]')];
    expect(seals).toHaveLength(1);
    const seal = seals[0]!;
    expect(seal.classList.contains("hall-seal")).toBe(true);
    expect(seal.closest("section")?.querySelector("#nominate")).not.toBeNull();
    const img = seal.querySelector("img");
    expect(img?.getAttribute("alt")).toBe(HALL_ART_ALT);
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("fetchpriority")).not.toBe("high");
  });
});
