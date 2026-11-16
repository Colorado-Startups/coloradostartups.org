// Step W3b: what each painting hotspot opens (src/components/regions/hotspots.ts).
// Pure shaping over made-up inputs; the DOM test over the built site is
// test/dom/l8/painting-hotspots.test.ts.
import type { Region } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { CARD_COMPANIES, CARD_RESOURCES, hotspotCards, type CardInputs } from "../../../src/components/regions/hotspots";

const region: Pick<Region, "id" | "name" | "hotspots"> = {
  id: "space-peak",
  name: "Space Peak",
  hotspots: [
    { x: 39, y: 49, kind: "companies", label: "Who builds here" },
    { x: 61, y: 74, kind: "event", label: "Next event" },
    { x: 12, y: 48, kind: "resources", label: "Where to get help" },
    { x: 36, y: 26, kind: "seat", label: "The organizer seat" },
  ],
};
const company = (n: number) => ({ id: `c${n}`, name: `Company ${n}`, website: `https://c${n}.example`, hq_city: "Colorado Springs" });
const resource = (n: number) => ({ id: `r${n}`, name: `Resource ${n}`, url: `https://r${n}.example`, city: "Colorado Springs" });

const full: CardInputs = {
  region,
  companies: Array.from({ length: 8 }, (_, i) => company(i)),
  companiesTotal: 8,
  companiesHref: "/leaderboard/?region=space-peak",
  event: { title: "Pitch night", url: "https://event.example", when: "Wed, Nov 18, 5:30 PM to 7:30 PM" },
  eventsHref: "https://calendar.example",
  resources: Array.from({ length: 5 }, (_, i) => resource(i)),
  resourcesTotal: 12,
  resourcesHref: "/ecosystem-canvas/?region=space-peak",
  seat: { title: "Space Peak Connector", open: true, href: "/get-involved/space-peak-connector/" },
  seatsHref: "/get-involved/",
};
const empty: CardInputs = {
  ...full,
  companies: [],
  companiesTotal: 0,
  event: undefined,
  resources: [],
  resourcesTotal: 0,
  seat: { title: "Space Peak Connector", open: false, holder: "Ada", href: "#organizer" },
};
const byKind = (input: CardInputs) => Object.fromEntries(hotspotCards(input).map((c) => [c.kind, c]));

describe("hotspot cards", () => {
  it("makes one card per hotspot, in data order, named by its label, with a unique id", () => {
    const cards = hotspotCards(full);
    expect(cards.map((c) => c.label)).toEqual(region.hotspots!.map((h) => h.label));
    expect(new Set(cards.map((c) => c.id)).size).toBe(4);
    for (const c of cards) expect(c.id).toMatch(/^hotspot-space-peak-/);
  });

  it("lists up to 5 companies, the next event with its date, 3 resources and the open seat", () => {
    const c = byKind(full);
    expect(c.companies!.links).toHaveLength(CARD_COMPANIES);
    expect(c.companies!.more).toEqual({ text: "See all 8 on the Leaderboard", href: full.companiesHref });
    expect(c.event!.links).toEqual([{ text: "Pitch night", href: "https://event.example", meta: full.event!.when }]);
    expect(c.event!.more.href).toBe(full.eventsHref);
    expect(c.resources!.links).toHaveLength(CARD_RESOURCES);
    expect(c.resources!.more.text).toBe("See all 12 Startup Resources here");
    expect(c.seat!.links[0]).toMatchObject({ text: "Space Peak Connector", href: full.seat.href });
    for (const card of Object.values(c)) expect(card.empty).toBeUndefined();
  });

  it("says so plainly when there is nothing to show, and still links on", () => {
    for (const card of hotspotCards(empty)) {
      expect(card.links, card.kind).toHaveLength(0);
      expect(card.empty, card.kind).toBeTruthy();
      expect(card.more.href, card.kind).toBeTruthy();
    }
    expect(byKind(empty).seat!.empty).toContain("Ada holds the Space Peak Connector seat");
  });

  it("opens no card for a place hotspot", () => {
    const withPlace = { ...full, region: { ...region, hotspots: [{ x: 50, y: 50, kind: "place" as const, label: "Pikes Peak", landmark: "Pikes Peak" }] } };
    expect(hotspotCards(withPlace)).toEqual([]);
  });
});
