// Post-launch item 12 over the built site (run `npm run build` first;
// test:content does). The region pages and the /regions/ chips call each
// regional seat by its title from positions.yaml (decision 67), never
// "organizer". On a region page, an open seat that takes applications links
// to /get-involved/apply/?role=<id> with the unpaid line beside it (the
// PositionCard tests cover that card); a /regions/ chip links to the region
// page, where the seat and its apply link are.
import { readFileSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { UNPAID_VOLUNTEER_LINE } from "../../../src/components/positions/positions";
import { REGIONS } from "../../../src/lib/regions/match";
import { readDist, SITE_DIR } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const positions = parse(readFileSync(path.resolve(SITE_DIR, "..", "data", "team", "positions.yaml"), "utf8")) as {
  id: string;
  area: string;
  region?: string;
  title: string;
  status: string;
  apply?: { open?: boolean };
}[];
const seatOf = (region: string) => positions.find((p) => p.area === "region" && p.region === region)!;
const applies = (p: ReturnType<typeof seatOf>) => p.status === "open" && p.apply?.open === true;

describe("the regional seats are Connector seats", () => {
  it("has one titled seat per region, so the checks below cover every region", () => {
    for (const id of REGION_IDS) expect(seatOf(id)?.title).toMatch(/ Connector$/);
  });

  describe.each(REGIONS.map((r) => [r.id, r] as const))("/regions/%s/", (id, region) => {
    const page = doc(readDist(`regions/${id}/index.html`));
    const seat = seatOf(id);

    // Only the seat and "Meet founders here" sections: a listed resource's own
    // description may say "organizer" and is not about the seat.
    it("names the seat by its title, and the seat and meet sections never say organizer", () => {
      const heading = page.getElementById("organizer");
      expect(text(heading)).toBe(seat.status === "open" ? `The ${seat.title} seat` : `Your ${seat.title}`);
      expect(text(heading?.closest("section"))).not.toMatch(/organizer/i);
      const meet = text(page.getElementById("meet")?.closest("section"));
      expect(meet).not.toMatch(/organizer/i);
      expect(meet).toContain("One Slack and one event calendar for all of Colorado.");
      expect(page.querySelector(`.organizer [data-position='${seat.id}']`), `${region.name} seat card`).not.toBeNull();
    });
  });

  describe("/regions/", () => {
    const index = doc(readDist("regions/index.html"));

    it.each(REGIONS.map((r) => [r.id, r] as const))("the %s chip shows the Connector seat and links to the region page", (id) => {
      const seat = seatOf(id);
      const chip = index.querySelector<HTMLElement>(`.region-chips [data-region='${id}']`);
      expect(text(chip)).not.toMatch(/organizer/i);
      if (seat.status === "open") expect(text(chip)).toContain("Connector seat open");
      expect(chip?.querySelector("a")?.getAttribute("href")).toBe(`/regions/${id}/`);
      // The apply link lives on the region page, beside the unpaid line.
      expect(chip?.querySelector("a[data-apply]")).toBeNull();
      if (applies(seat)) {
        const apply = doc(readDist(`regions/${id}/index.html`)).querySelector<HTMLAnchorElement>(".organizer a[data-apply]");
        expect(apply?.getAttribute("href")).toBe(`/get-involved/apply/?role=${seat.id}`);
      }
    });

    it("says how the Connector seats work", () => {
      const how = text(index.getElementById("how-title")?.parentElement);
      expect(how).toContain("1 Connector per region. A person, never an AI keeper.");
      expect(how).not.toMatch(/organizer/i);
    });
  });

  it("llms.txt names the Connector seats beside the organizer seat", () => {
    expect(readDist("llms.txt")).toContain("Only people moderate the groups or hold Connector and organizer seats.");
  });

});
