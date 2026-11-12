import { describe, expect, it } from "vitest";

import { HALL_ART_ALT } from "../../../src/components/art/keepers";
import { readDist } from "../pages";

// L5b (#239, #723): the Leaderboard's title is carved in a lintel, and the
// Great Hall picture sits beside the lede, with an alt that discloses its
// keepers. It loads lazily and asks for a small file on a phone, so the lede
// stays the mobile LCP. Built HTML from dist/.

const doc = new DOMParser().parseFromString(readDist("leaderboard/index.html"), "text/html");
const hero = doc.querySelector("main > section")!;

describe("/leaderboard/ hero", () => {
  it("carves the one h1 in a lintel banner", () => {
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    const h1 = hero.querySelector(".hall-banner--lintel h1");
    expect(h1?.textContent?.trim()).toBe("The Leaderboard");
  });

  it("shows the Great Hall picture beside the lede, its keepers disclosed", () => {
    const img = hero.querySelector('[data-art="hero/hall"] img');
    expect(img?.getAttribute("alt")).toBe(HALL_ART_ALT);
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("sizes")).toBe("(min-width: 64rem) 26rem, 14rem");
  });

  it("keeps the nominate action in the hero", () => {
    expect(hero.querySelector('a.btn--gold[href="/leaderboard/nominate/"]')).not.toBeNull();
  });
});
