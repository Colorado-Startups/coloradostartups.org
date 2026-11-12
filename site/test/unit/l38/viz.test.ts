// L38: the SVG figures in site/src/lib/seats/viz.ts, ported from the kit's
// viz.py. Every figure parses as XML. The map and the diagram carry a
// <title> and a <desc> their aria-labelledby names; the hours bar and the
// trail are aria-hidden. Maps carry no numbers (the owner's rule 5), and the
// diagrams show helpers, never investors (rule 6).
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { loadGeo } from "../../../src/lib/seats/load";
import {
  esc,
  frontRangeMap,
  hoursBar,
  networkDiagram,
  SEAT_NARROW_WIDTH,
  stepsTrail,
  type MapRegion,
  type NetworkSeat,
} from "../../../src/lib/seats/viz";

const geo = loadGeo();
const REGIONS: MapRegion[] = ["all", "photon-mountain", "fusion-canyon", "space-peak"];
const SEATS: NetworkSeat[] = ["slack-community-lead", "photon-mountain-connector", "fusion-canyon-connector", "space-peak-connector"];

/** The SVG parsed as XML. Throws on a parse error, which jsdom reports as a <parsererror> document. */
function svgOf(markup: string): SVGSVGElement {
  const doc = new JSDOM(markup, { contentType: "image/svg+xml" }).window.document;
  const root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.getElementsByTagName("parsererror").length > 0) throw new Error(`not an SVG: ${markup.slice(0, 80)}`);
  return root as unknown as SVGSVGElement;
}

function expectLabelled(svg: SVGSVGElement): void {
  expect(svg.getAttribute("role")).toBe("img");
  const ids = (svg.getAttribute("aria-labelledby") ?? "").split(" ");
  expect(ids).toHaveLength(2);
  const [title, desc] = ids.map((id) => svg.ownerDocument.getElementById(id));
  expect(title?.nodeName).toBe("title");
  expect(desc?.nodeName).toBe("desc");
  expect(title?.textContent?.length).toBeGreaterThan(10);
  expect(desc?.textContent?.length).toBeGreaterThan(10);
}

describe("svgOf (self-test)", () => {
  it("rejects markup that does not parse (known bad) and accepts an SVG (known clean)", () => {
    expect(() => svgOf("<svg><text>open")).toThrow();
    expect(svgOf('<svg xmlns="http://www.w3.org/2000/svg"><text>1</text></svg>').nodeName).toBe("svg");
  });
});

describe("frontRangeMap", () => {
  it.each(REGIONS)("%s parses, and has a title and a description", (region) => {
    expectLabelled(svgOf(frontRangeMap(region, geo)));
  });

  it.each(REGIONS)("%s carries no digits in any text, title or description", (region) => {
    expect(svgOf(frontRangeMap(region, geo)).textContent).not.toMatch(/\d/);
  });

  it("names every outpost on the statewide map, and the Slack seat's reach", () => {
    const text = svgOf(frontRangeMap("all", geo)).textContent ?? "";
    for (const name of ["Photon", "Mountain", "Fusion", "Canyon", "Space Peak", "Slack seat: statewide"]) expect(text).toContain(name);
  });

  it("labels each outpost's own towns on its map", () => {
    const text = svgOf(frontRangeMap("space-peak", geo)).textContent ?? "";
    for (const town of ["Colorado Springs", "Monument", "Fountain", "Woodland Park", "Manitou Springs", "Ute Pass", "Pikes Peak"]) {
      expect(text).toContain(town);
    }
  });

  it("is the same drawing every time", () => {
    expect(frontRangeMap("photon-mountain", geo)).toBe(frontRangeMap("photon-mountain", geo));
  });

  // The core cities are data/regions' four, not the kit's narrower set (#180).
  it.each([
    ["photon-mountain", ["Boulder", "Golden", "Arvada", "Denver"]],
    ["fusion-canyon", ["Fort Collins", "Loveland", "Windsor", "Greeley"]],
  ] as const)("draws %s's core cities as core", (region, cities) => {
    const svg = svgOf(frontRangeMap(region, geo));
    expect(svg.querySelectorAll(".sv-city-core")).toHaveLength(cities.length);
    const strong = [...svg.querySelectorAll(".sv-label-strong")].map((t) => t.textContent);
    expect(strong.sort()).toEqual([...cities].sort());
  });

  it("labels only the kit's hubs on the smaller statewide map", () => {
    const svg = svgOf(frontRangeMap("all", geo));
    const strong = [...svg.querySelectorAll(".sv-label-strong")].map((t) => t.textContent).sort();
    expect(strong).toEqual(["Boulder", "Colorado Springs", "Denver", "Fort Collins", "Golden"]);
    expect(strong).toEqual(geo.cities.filter((c) => c.hub).map((c) => c.name).sort());
  });
});

// The phone drawings (#329): the same figure, 310 units wide, with ids of
// their own so a page carrying both drawings has no duplicate id.
describe("phone drawings", () => {
  const pairs: [string, string, string][] = [
    ...REGIONS.map((r) => [`map ${r}`, frontRangeMap(r, geo), frontRangeMap(r, geo, { narrow: true })] as [string, string, string]),
    ...SEATS.map((s) => [`network ${s}`, networkDiagram(s), networkDiagram(s, { narrow: true })] as [string, string, string]),
  ];

  it.each(pairs)("%s is drawn at the phone width, shown at that size, and labelled", (_, __, narrow) => {
    const svg = svgOf(narrow);
    expectLabelled(svg);
    expect(svg.getAttribute("viewBox")).toMatch(new RegExp(`^0 0 ${SEAT_NARROW_WIDTH} `));
    expect(svg.getAttribute("width")).toBe(String(SEAT_NARROW_WIDTH));
    expect(svg.getAttribute("class")).toContain("sv--narrow");
    expect(svg.textContent).not.toMatch(/\d/);
  });

  it.each(pairs)("%s shares no id with the wide drawing", (_, wide, narrow) => {
    const ids = (markup: string) => [...markup.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const narrowIds = ids(narrow);
    expect(narrowIds.length).toBeGreaterThan(0);
    for (const id of narrowIds) expect(ids(wide), id).not.toContain(id);
  });

  it.each(pairs)("%s covers the same towns and people as the wide drawing", (_, wide, narrow) => {
    // The title, and each "<outpost> covers ..." sentence or the diagram's own
    // description. A phone map's tighter view can leave a peak out, and its
    // description then says only the peaks it marks.
    const said = (svg: SVGSVGElement) => [
      svg.querySelector("title")?.textContent,
      ...(svg.querySelector("desc")?.textContent ?? "").split(/(?<=\.) /).filter((t) => !t.startsWith("Peaks marked")),
    ];
    expect(said(svgOf(narrow))).toEqual(said(svgOf(wide)));
  });
});

describe("networkDiagram", () => {
  it.each(SEATS)("%s parses, and has a title and a description", (seat) => {
    expectLabelled(svgOf(networkDiagram(seat)));
  });

  it.each(SEATS)("%s shows helpers, never investors, and no digits", (seat) => {
    const text = svgOf(networkDiagram(seat)).textContent ?? "";
    expect(text).not.toMatch(/investor|fund|capital/i);
    expect(text).not.toMatch(/\d/);
    expect(text).toContain("You");
  });

  it("calls Communitas an AI agent wherever the Slack diagram names it", () => {
    const svg = svgOf(networkDiagram("slack-community-lead"));
    const labels = [...svg.querySelectorAll("text, desc")].map((t) => t.textContent ?? "").filter((t) => t.includes("Communitas"));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toContain("AI agent");
  });
});

describe("hoursBar and stepsTrail", () => {
  it("draws one segment per course, hidden from assistive tech", () => {
    const svg = svgOf(hoursBar([2.5, 4, 0.75]));
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("rect")).toHaveLength(3);
    expect(() => hoursBar([])).toThrow();
  });

  it("draws three waypoints, marked as ordinals, hidden from assistive tech", () => {
    const svg = svgOf(stepsTrail());
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const nums = [...svg.querySelectorAll("text")];
    expect(nums.map((t) => t.textContent)).toEqual(["1", "2", "3"]);
    for (const t of nums) expect(t.hasAttribute("data-ordinal")).toBe(true);
  });

  it("escapes text the way the kit does", () => {
    expect(esc(`Fish & "Chips" <b>'s`)).toBe("Fish &amp; &quot;Chips&quot; &lt;b&gt;&#x27;s");
  });
});
