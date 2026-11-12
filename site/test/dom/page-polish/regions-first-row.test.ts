import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// #258, /regions/ half: the first region card's art sits in the first screen
// at every width, so it loads eagerly, at high priority. At 375 px the first
// screen holds that card alone, so cards 2 and 3 stay lazy and never compete
// with it (review of #511). The same cards on the home page sit far below the
// first screen and stay lazy.

const page = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");

describe("region card art loading", () => {
  it("loads only the first card eagerly on /regions/, at high priority", () => {
    const imgs = [...page("regions/index.html").querySelectorAll(".region-grid li img")];
    expect(imgs).toHaveLength(3);
    expect(imgs.map((img) => img.getAttribute("loading"))).toEqual(["eager", "lazy", "lazy"]);
    expect(imgs[0]!.getAttribute("fetchpriority")).toBe("high");
    for (const img of imgs.slice(1)) expect(img.getAttribute("fetchpriority")).not.toBe("high");
  });

  it("keeps the home page's region teasers lazy", () => {
    const imgs = [...page("index.html").querySelectorAll("main li[data-region] img")];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.getAttribute("loading")).toBe("lazy");
  });
});
