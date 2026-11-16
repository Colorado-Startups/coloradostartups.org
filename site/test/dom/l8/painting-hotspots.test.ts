// Step W3b over the built site (run `npm run build` first; test:content does):
// each region page's painting carries 4 hotspots. Each is a real button,
// named by its label, that opens a popover card holding at least one link;
// and the plain list under the painting holds the same links.
import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { REGIONS } from "../../../src/lib/regions/match";
import { readDist } from "../pages";

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const hrefs = (root: Element) => [...root.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!).sort();

describe.each(REGION_IDS)("%s painting hotspots", (id) => {
  const page = new DOMParser().parseFromString(readDist(`regions/${id}/index.html`), "text/html");
  const media = page.querySelector(".region-art__media")!;
  const buttons = [...media.querySelectorAll<HTMLButtonElement>(".hotspots button[popovertarget]")];
  const data = REGIONS.find((r) => r.id === id)!.hotspots ?? [];

  it("has 4 hotspot buttons, each named by its label, above the clip and apart from Pause", () => {
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => text(b))).toEqual(data.map((h) => h.label));
    for (const b of buttons) {
      expect(b.getAttribute("type")).toBe("button");
      expect(b.hasAttribute("aria-label"), "the visible label is the name").toBe(false);
      expect(b.hasAttribute("data-clip-toggle")).toBe(false);
    }
    // The layer follows the clip in the DOM, and Pause follows the layer.
    const order = [...media.children].map((el) => el.className);
    expect(order.findIndex((c) => c.includes("hotspots"))).toBeGreaterThan(order.findIndex((c) => c.includes("region-art__clip")));
    expect(order.findIndex((c) => c.includes("region-art__toggle"))).toBeGreaterThan(order.findIndex((c) => c.includes("hotspots")));
    expect(media.querySelector("button[data-clip-toggle]")?.textContent?.trim()).toBe("Pause");
  });

  it("opens a popover card for each, named the same, with a link on", () => {
    for (const b of buttons) {
      const card = page.getElementById(b.getAttribute("popovertarget")!);
      expect(card, text(b)).not.toBeNull();
      expect(card!.hasAttribute("popover"), text(b)).toBe(true);
      expect(text(card!.querySelector(".hotspot-card__title")), text(b)).toBe(text(b));
      expect(card!.querySelector("a[data-hotspot-more][href]"), text(b)).not.toBeNull();
      // Something to show, or a plain line saying there is nothing yet.
      expect(card!.querySelectorAll("li").length + card!.querySelectorAll(".hotspot-card__empty").length, text(b)).toBeGreaterThan(0);
    }
  });

  it("holds the same links in the plain list under the painting", () => {
    const list = page.querySelector("details[data-painting-links]")!;
    expect(list).not.toBeNull();
    const cards = buttons.map((b) => page.getElementById(b.getAttribute("popovertarget")!)!);
    expect(hrefs(list)).toEqual(cards.flatMap((c) => hrefs(c)).sort());
    expect([...list.querySelectorAll(".painting-links__title")].map((p) => text(p))).toEqual(data.map((h) => h.label));
  });
});
