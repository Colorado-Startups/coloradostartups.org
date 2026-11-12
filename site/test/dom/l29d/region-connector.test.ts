// Post-launch item 12 over the built site (run `npm run build` first;
// test:content does). The region pages, /regions/ and the home page's region
// teasers call each regional seat by its title from positions.yaml (decision
// 67), never "organizer". An open seat that takes applications links to
// /get-involved/apply/?role=<id> with the unpaid line beside it.
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
      expect(meet).toContain(`Startup events in ${region.name} and across Colorado go on the event calendar.`);
    });
  });

  describe("/regions/", () => {
    const index = doc(readDist("regions/index.html"));

    it.each(REGIONS.map((r) => [r.id, r] as const))("the %s card shows the Connector seat", (id) => {
      const seat = seatOf(id);
      const card = index.querySelector<HTMLElement>(`[data-region='${id}']`);
      expect(text(card)).not.toMatch(/organizer/i);
      if (seat.status === "open") expect(text(card)).toContain("Connector seat open");
      const apply = card?.querySelector<HTMLAnchorElement>("a[data-apply]");
      if (applies(seat)) {
        expect(apply?.getAttribute("href")).toBe(`/get-involved/apply/?role=${seat.id}`);
        expect(text(apply)).toBe(`Apply to be the ${seat.title}`);
        expect(text(card?.querySelector("[data-unpaid-line]"))).toBe(UNPAID_VOLUNTEER_LINE);
      } else {
        expect(apply).toBeNull();
      }
    });

    it("says how the Connector seats work", () => {
      const how = text(index.getElementById("how-title")?.parentElement);
      expect(how).toContain("Each region has one Connector seat, for a person.");
      expect(how).not.toMatch(/organizer/i);
    });
  });

  it("llms.txt names the Connector seats beside the organizer seat", () => {
    expect(readDist("llms.txt")).toContain("Only people moderate the groups or hold Connector and organizer seats.");
  });

  it("the home page's region teasers say Connector", () => {
    const home = doc(readDist("index.html"));
    const section = home.getElementById("regions")?.closest("section");
    expect(text(section)).toContain("Each one has a Connector seat for a person");
    for (const id of REGION_IDS) {
      const teaser = section?.querySelector(`[data-region='${id}']`);
      if (seatOf(id).status === "open") expect(text(teaser)).toContain("Connector seat open");
      expect(text(teaser)).not.toMatch(/organizer/i);
    }
  });
});
