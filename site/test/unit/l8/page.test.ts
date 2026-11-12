// L8: the pure helpers behind the region pages. The organizer seat is open in
// today's data, so the filled case runs here on fixtures.
import type { Company, Person, Position } from "@cs/shared";
import { describe, expect, it } from "vitest";

import {
  applyHref,
  RAISE_HAND_EMAIL,
  raiseHandHref,
  takesApplications,
} from "../../../src/components/positions/positions";
import { REGIONS } from "../../../src/lib/regions/match";
import { andList, canvasCityHref, honoreesIn, inRegion, organizerFor } from "../../../src/lib/regions/page";

const seat = (over: Partial<Position> = {}): Position => ({
  id: "space-peak-connector",
  title: "Space Peak Connector",
  area: "region",
  region: "space-peak",
  summary: "Gather the founders of Colorado Springs and the Pikes Peak region.",
  what_you_do: ["Host founder meetups in the region."],
  status: "open",
  ...over,
});

const person: Person = {
  id: "ada-founder",
  name: "Ada Founder",
  title: "Space Peak Connector",
  group: "community",
  bio: "Ada builds a company in Colorado Springs.",
  links: [],
};

describe("organizerFor", () => {
  it("returns an open seat with no holder", () => {
    const got = organizerFor("space-peak", [seat()], [person]);
    expect(got.position.id).toBe("space-peak-connector");
    expect(got.holder).toBeUndefined();
  });

  it("returns the person in a filled seat", () => {
    const filled = seat({ status: "filled", holder: "ada-founder" });
    expect(organizerFor("space-peak", [filled], [person]).holder?.name).toBe("Ada Founder");
  });

  it("ignores seats for other regions and other areas", () => {
    const others = [
      seat({ id: "photon-mountain-connector", region: "photon-mountain" }),
      { ...seat({ id: "slack-community-lead", area: "community" }), region: undefined },
    ];
    expect(() => organizerFor("space-peak", others, [])).toThrow(/needs one organizer seat for space-peak; found 0/);
  });

  it("refuses two seats for one region", () => {
    expect(() => organizerFor("space-peak", [seat(), seat({ id: "second" })], [])).toThrow(/found 2/);
  });

  it("refuses a filled seat whose holder is not in people.yaml", () => {
    const filled = seat({ status: "filled", holder: "nobody" });
    expect(() => organizerFor("space-peak", [filled], [person])).toThrow(/"nobody", who is not in people.yaml/);
  });
});

// The region seat uses L9's helpers (L15), so a region page and /get-involved/
// send people to the same place: the application form for a seat that takes
// applications (L19), and otherwise the same email.
describe("the call to action for a region seat", () => {
  it("links a seat that takes applications to the form, with the seat preselected", () => {
    const applying = seat({ apply: { open: true, courses: ["claude-101"] } });
    expect(takesApplications(applying)).toBe(true);
    expect(applyHref(applying)).toBe("/get-involved/apply/?role=space-peak-connector");
  });

  it("opens an email to info@ with the seat in the subject for any other open seat", () => {
    expect(takesApplications(seat())).toBe(false);
    expect(takesApplications(seat({ apply: { open: false, courses: ["claude-101"] } }))).toBe(false);
    const href = raiseHandHref(seat());
    expect(RAISE_HAND_EMAIL).toBe("info@coloradostartups.org");
    expect(href).toMatch(/^mailto:info@coloradostartups\.org\?subject=Raise%20my%20hand%3A%20Space%20Peak%20Connector&/);
    expect(decodeURIComponent(new URL(href).searchParams.get("subject") ?? "")).toBe("Raise my hand: Space Peak Connector");
  });

  it("never sends a filled seat to the form", () => {
    const filled = seat({ status: "filled", holder: "ada-founder", apply: { open: true, courses: ["claude-101"] } });
    expect(takesApplications(filled)).toBe(false);
  });
});

describe("andList", () => {
  it("joins in the house style, with no serial comma", () => {
    expect(andList([])).toBe("");
    expect(andList(["Colorado Springs"])).toBe("Colorado Springs");
    expect(andList(["Boulder", "Denver"])).toBe("Boulder and Denver");
    expect(andList(["Boulder", "Golden", "Arvada", "Denver"])).toBe("Boulder, Golden, Arvada and Denver");
  });
});

describe("inRegion and honoreesIn", () => {
  const company = (id: string, hq_city: string): Company => ({
    id,
    name: id,
    website: `https://${id}.example`,
    hq_city,
    sector: "Software",
    description: "A company.",
    sources: [`https://${id}.example/about`],
  });
  const companies = [
    company("a", "Boulder"),
    company("b", "Colorado Springs"),
    company("c", "Greeley"),
    company("d", "Bentonville, AR, with a Denver engineering team"),
    company("e", "Longmont"),
    company("f", "Durango"),
  ];

  it("keeps the companies headquartered in the region, in input order", () => {
    expect(honoreesIn("photon-mountain", companies).map((c) => c.id)).toEqual(["a", "e"]);
    expect(honoreesIn("space-peak", companies).map((c) => c.id)).toEqual(["b"]);
    expect(honoreesIn("fusion-canyon", companies).map((c) => c.id)).toEqual(["c"]);
  });

  it("filters resources by their city, leaving statewide and online out", () => {
    const cards = [{ city: "Denver" }, { city: "statewide" }, { city: "online" }, { city: "Golden" }];
    expect(inRegion("photon-mountain", cards, (c) => c.city, REGIONS)).toEqual([{ city: "Denver" }, { city: "Golden" }]);
  });
});

describe("canvasCityHref", () => {
  it("links the directory filtered to one city, the way L3 reads ?city=", () => {
    expect(canvasCityHref("Fort Collins")).toBe("/ecosystem-canvas/?city=Fort%20Collins");
    expect(new URLSearchParams(canvasCityHref("Fort Collins").split("?")[1]).get("city")).toBe("Fort Collins");
    expect(canvasCityHref("statewide")).toBe("/ecosystem-canvas/?city=statewide");
  });
});
