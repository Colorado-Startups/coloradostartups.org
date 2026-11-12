import { describe, expect, it } from "vitest";

import { GUIDE_SLUGS } from "../../../src/lib/guides/guides";
import { readDist } from "../pages";

// L5a, card "Phones: make standalone text links 44 px targets" (#259): every
// guide's standalone links (the contents list, each "Back to contents" and
// the other guides) carry .tap-target, so a phone gets 44 px rows
// (global.css). The breadcrumb gets the same from .crumbs. Run `npm run build`
// first.

const STANDALONE = ["#guide-contents a", "[data-guide-back] a", ".more a"];

describe.each(GUIDE_SLUGS)("/guides/%s/", (slug) => {
  const page = new DOMParser().parseFromString(readDist(`guides/${slug}/index.html`), "text/html");

  it.each(STANDALONE)("%s links are tap targets", (selector) => {
    const links = [...page.querySelectorAll(selector)];
    expect(links.length, selector).toBeGreaterThan(0);
    for (const a of links) expect(a.classList.contains("tap-target"), a.outerHTML).toBe(true);
  });
});
