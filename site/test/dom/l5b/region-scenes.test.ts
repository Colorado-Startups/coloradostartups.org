import { readFileSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readDist, SITE_DIR } from "../pages";

// L5b (#204): each region's painted scene shows wherever its card does. On
// /get-involved/ a region's Connector seat carries its scene, as on
// /regions/. On the region's own page the seat card does not repeat it: the
// page's hero already shows the scene. Built HTML from dist/.

const positions = parse(readFileSync(path.join(SITE_DIR, "../data/team/positions.yaml"), "utf8")) as {
  id: string;
  region?: string;
}[];
const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");

describe("/get-involved/ seat cards", () => {
  const main = doc("get-involved/index.html").querySelector("main")!;

  it("show the region's scene on every region seat, and none on the others", () => {
    const cards = [...main.querySelectorAll<HTMLElement>("[data-position]")];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const region = positions.find((p) => p.id === card.dataset.position)?.region;
      const art = card.querySelector(".hall-card__media [data-art]");
      if (region) expect(art?.getAttribute("data-art"), card.dataset.position).toBe(`regions/${region}`);
      else expect(art, card.dataset.position).toBeNull();
    }
    expect(cards.some((c) => c.querySelector("[data-art^='regions/']"))).toBe(true);
  });
});

describe.each(REGION_IDS)("/regions/%s/ seat card", (id) => {
  it("leaves the scene to the page's hero", () => {
    const section = doc(`regions/${id}/index.html`).getElementById("organizer")!.parentElement!;
    expect(section.querySelector("[data-position] [data-art]")).toBeNull();
  });
});
