// Page polish, #258, over the built site (run `npm run build` first;
// test:content does). Paul's photo sits in the first screen of /team/ at 375
// and 1280 px (design review, 2026-11-02), so it loads eagerly. Every other
// image on the page sits below the first screen and stays lazy.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";
import { ON_FIXTURES } from "../../people-source";

const page = new DOMParser().parseFromString(readDist("team/index.html"), "text/html");
const images = [...page.querySelectorAll<HTMLImageElement>("main img")];

describe("/team/ image loading (#258)", () => {
  it("loads the first leader's photo eagerly, and it is the first image on the page", () => {
    const first = page.querySelector<HTMLImageElement>("#leadership [data-person] img");
    expect(first).not.toBeNull();
    expect(images[0]).toBe(first);
    if (!ON_FIXTURES) expect(first?.closest("[data-person]")?.getAttribute("data-person")).toBe("paul-foley");
    expect(first?.getAttribute("loading")).toBe("eager");
  });

  it("keeps every other photo and portrait lazy", () => {
    const rest = images.slice(1);
    expect(rest.length).toBeGreaterThan(0);
    for (const img of rest) expect(img.getAttribute("loading"), img.getAttribute("alt") ?? img.src).toBe("lazy");
  });
});
