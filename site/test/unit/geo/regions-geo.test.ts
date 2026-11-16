// The statewide map's geography (data/geo/, built by scripts/geo/build.mjs):
// each zone is the loop its named roads close, about Silicon Valley's size.
// Its views (scripts/geo/views.mjs): frames, highways and relief images. And
// its build-time drawing (lib/regions/colorado-map.ts).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  buildRegions,
  buildYardstick,
  format,
  insideRing,
  milesToRing,
  ON_THE_LINE_MI,
  readBoundaries,
  readCentres,
  readPlaces,
  readRegions,
  readRoads,
  ringsOverlap,
  roadsDrift,
  selfCrossing,
  SIZE_BAND,
} from "../../../../scripts/geo/build.mjs";
import { buildViews } from "../../../../scripts/geo/views.mjs";
import { COLORADO, COLORADO_BOUNDS, ZONES, zoneBounds, zoneById } from "../../../src/lib/regions/colorado-geo";
import { clockwise, coloradoMapSvg, signedArea, viewOf } from "../../../src/lib/regions/colorado-map";
import { HIGHWAYS, inFrame, LOOP_ROADS, VIEWS, YARDSTICK } from "../../../src/lib/regions/colorado-views";
import { REGION_COLORS as REGION_COLOR } from "../../../src/lib/regions/map";
import { mapFileSvg } from "../../../src/lib/regions/map-file";

const ROOT = path.join(__dirname, "../../../..");
const places = readPlaces(path.join(ROOT, "data/geo/places.csv"));
const regions = readRegions(path.join(ROOT, "data/regions"));
const roads = readRoads(path.join(ROOT, "data/geo/roads.geojson"));
const boundaries = readBoundaries(path.join(ROOT, "data/geo/boundaries.yaml")) as Record<string, { road: string }[]>;
const centres = readCentres(path.join(ROOT, "data/positions/geo.yaml"));
const yardstick = buildYardstick(roads).features[0]!.properties as { area_sq_mi: number; span_mi: number };

describe("data/geo/regions.geojson", () => {
  // The same checks as `node scripts/geo/build.mjs --check`, in CI.
  it("matches what data/regions, roads.geojson and places.csv build to (run scripts/geo/build.mjs --roads if not)", () => {
    expect(readFileSync(path.join(ROOT, "data/geo/regions.geojson"), "utf8")).toBe(format(buildRegions(places, regions, roads, centres)));
  });

  it("comes from roads traced for today's boundaries.yaml", () => {
    expect(roadsDrift(boundaries, roads)).toBeNull();
  });

  it("has one zone per region, in the shared region ids", () => {
    expect(ZONES.features.map((z) => z.id).sort()).toEqual([...REGION_IDS].sort());
  });

  it("follows the roads boundaries.yaml names, in order", () => {
    for (const z of ZONES.features) {
      expect(z.properties.roads, z.id).toEqual(boundaries[z.id]!.map((leg) => leg.road));
      expect(z.properties.roads.length, z.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("closes each loop without crossing itself", () => {
    for (const z of ZONES.features) {
      const ring = z.geometry.coordinates[0]!;
      expect(ring[0], z.id).toEqual(ring.at(-1));
      expect(selfCrossing(ring), z.id).toBeNull();
    }
  });

  // Cities sit on the corners: inside the loop, or on its line.
  it("puts every city inside its loop or on its line", () => {
    for (const z of ZONES.features) {
      const ring = z.geometry.coordinates[0]!;
      expect(z.properties.cityPoints.map((c) => c.name), z.id).toEqual(z.properties.cities);
      for (const c of z.properties.cityPoints) {
        const miles = insideRing([c.lon, c.lat], ring) ? 0 : milesToRing([c.lon, c.lat], ring);
        expect(miles, `${c.name} in ${z.id}`).toBeLessThanOrEqual(ON_THE_LINE_MI);
      }
    }
  });

  it("gives every nearby town a dot", () => {
    for (const z of ZONES.features) expect(z.properties.townPoints.map((t) => t.name), z.id).toEqual(z.properties.towns);
  });

  it("keeps the zones apart", () => {
    const rings = ZONES.features.map((z) => z.geometry.coordinates[0]!);
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) expect(ringsOverlap(rings[i], rings[j])).toBe(false);
  });

  // Paul, 2026-11-15: each region is about the size of Silicon Valley.
  it("keeps each loop about Silicon Valley's size", () => {
    for (const z of ZONES.features) {
      expect(z.properties.vs_silicon_valley, z.id).toBeCloseTo(z.properties.area_sq_mi / yardstick.area_sq_mi, 2);
      expect(z.properties.vs_silicon_valley, z.id).toBeGreaterThanOrEqual(SIZE_BAND[0]);
      expect(z.properties.vs_silicon_valley, z.id).toBeLessThanOrEqual(SIZE_BAND[1]);
    }
  });

  it("says each zone is a proposal, not a legal line", () => {
    for (const z of ZONES.features) expect(z.properties.note).toMatch(/proposal, not a legal line/);
  });
});

describe("data/geo/silicon-valley.geojson", () => {
  it("matches what roads.geojson builds to, and is a sound loop of the size measured", () => {
    const built = buildYardstick(roads);
    expect(readFileSync(path.join(ROOT, "data/geo/silicon-valley.geojson"), "utf8")).toBe(format(built));
    const ring = built.features[0]!.geometry.coordinates[0]! as [number, number][];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(selfCrossing(ring)).toBeNull();
    // US-101 and I-280 from Menlo Park to San Jose, closed by CA-84: 95 sq mi and 22.5 mi across, traced 2026-11-15.
    expect(yardstick.area_sq_mi).toBeGreaterThanOrEqual(90);
    expect(yardstick.area_sq_mi).toBeLessThanOrEqual(100);
    expect(yardstick.span_mi).toBeGreaterThan(20);
    expect(yardstick.span_mi).toBeLessThan(25);
  });
});

describe("data/geo/colorado.geojson", () => {
  // data/positions/geo.yaml state_bounds come from the volunteer kit; the outline should agree within 0.05 degrees.
  it("spans the state bounds the seat maps use", () => {
    const geo = YAML.parse(readFileSync(path.join(ROOT, "data/positions/geo.yaml"), "utf8")) as {
      state_bounds: { north: number; south: number; east: number; west: number };
    };
    const [[west, south], [east, north]] = COLORADO_BOUNDS;
    const b = geo.state_bounds;
    for (const [got, want] of [
      [west, b.west],
      [south, b.south],
      [east, b.east],
      [north, b.north],
    ]) {
      expect(Math.abs(got - want)).toBeLessThan(0.05);
    }
    expect(COLORADO.features[0]!.properties.name).toBe("Colorado");
  });
});

describe("data/geo/views.json", () => {
  // The same check as `node scripts/geo/views.mjs --check`, in CI.
  it("matches what the zones and the outline build to (run scripts/geo/views.mjs if not)", () => {
    expect(readFileSync(path.join(ROOT, "data/geo/views.json"), "utf8")).toBe(`${JSON.stringify(buildViews(COLORADO, ZONES), null, 1)}\n`);
  });

  it("has the statewide view, and a zoomed view and a 16:9 thumbnail for each region", () => {
    expect(Object.keys(VIEWS).sort()).toEqual(["state", ...REGION_IDS.flatMap((id) => [`thumb-${id}`, `zone-${id}`])].sort());
    for (const id of REGION_IDS) expect(VIEWS[`thumb-${id}`].width / VIEWS[`thumb-${id}`].height).toBeCloseTo(16 / 9, 2);
  });

  it("holds each zone's loop and cities well inside its frames", () => {
    for (const z of ZONES.features) {
      for (const view of [VIEWS[`zone-${z.id}`], VIEWS[`thumb-${z.id}`]]) {
        for (const [lon, lat] of [...z.geometry.coordinates[0]!, ...z.properties.cityPoints.map((c) => [c.lon, c.lat] as [number, number])]) {
          const [x, y] = inFrame(view, [lon, lat]);
          for (const v of [x, y]) {
            expect(v, z.id).toBeGreaterThan(0.1);
            expect(v, z.id).toBeLessThan(0.9);
          }
        }
      }
    }
  });

  it("has a relief image for every view", () => {
    for (const id of Object.keys(VIEWS)) expect(existsSync(path.join(ROOT, `site/src/assets/maps/relief-${id}.jpg`)), id).toBe(true);
  });

  it("has highways for every view, Interstate 25 among them", () => {
    for (const view of ["state", ...REGION_IDS]) {
      expect(HIGHWAYS.filter((h) => h.view === view && h.name === "I-25"), view).toHaveLength(1);
    }
  });

  it("carries the yardstick the size rule measures against", () => {
    expect(YARDSTICK.name).toBe("Silicon Valley");
    expect(YARDSTICK.area_sq_mi).toBe(yardstick.area_sq_mi);
  });
});

describe("coloradoMapSvg", () => {
  const svg = coloradoMapSvg({ label: "Map label", description: "Map description" });
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;
  const text = [...root.querySelectorAll("text")].map((t) => t.textContent);

  it("is one labelled image to assistive tech", () => {
    expect(root.getAttribute("role")).toBe("img");
    expect(svg).toContain("Map label");
  });

  it("names all three zones and dots every city", () => {
    for (const z of ZONES.features) expect(text, z.id).toContain(z.properties.name);
    const cities = ZONES.features.flatMap((z) => z.properties.cityPoints).length;
    expect(root.querySelectorAll("circle").length).toBe(cities);
  });

  it("is a real map: interstates and peaks by name, and a mile bar", () => {
    for (const name of ["I-25", "I-70", "I-76", "Longs Peak", "Pikes Peak", "100 mi"]) expect(text, name).toContain(name);
  });

  // d3-geo needs clockwise exterior rings; a counterclockwise one fills the globe.
  it("hands Plot clockwise rings, so each shape is the shape and not the globe around it", () => {
    for (const f of [...COLORADO.features, ...ZONES.features]) {
      expect(signedArea(clockwise(f).geometry.coordinates[0]!), f.id).toBeLessThan(0);
    }
  });

  it("is drawn to its frame, with every zone well inside it", () => {
    const { frame } = viewOf();
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${frame.width} ${frame.height}`);
    for (const z of ZONES.features) {
      const [[west, south], [east, north]] = zoneBounds(z.id);
      for (const corner of [inFrame(frame, [west, south]), inFrame(frame, [east, north])]) {
        for (const v of corner) {
          expect(v, z.id).toBeGreaterThan(0.05);
          expect(v, z.id).toBeLessThan(0.95);
        }
      }
    }
  });

  it("draws in the region tokens, never a hex", () => {
    expect(svg).toMatch(/var\(--c-accent-deep\)/);
    expect(svg).toMatch(/var\(--c-community\)/);
    expect(svg).toMatch(/var\(--c-fire\)/);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

// A region page's map: the drawing zoomed to one zone, as the live map is.
describe.each(REGION_IDS)("coloradoMapSvg zoomed to %s", (id) => {
  const zone = zoneById(id);
  const { frame } = viewOf({ zone: id });
  const svg = coloradoMapSvg({ label: "Zone label", description: "Zone description" }, { zone: id });
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;
  const text = [...root.querySelectorAll("text")].map((t) => t.textContent);
  const within = (p: { lon: number; lat: number }) => p.lon > frame.west && p.lon < frame.east && p.lat > frame.south && p.lat < frame.north;

  it("is one labelled image", () => {
    expect(root.getAttribute("role")).toBe("img");
    expect(svg).toContain("Zone label");
  });

  it("names its cities, and dots the nearby towns in the frame", () => {
    for (const c of zone.properties.cityPoints) expect(text, c.name).toContain(c.name);
    expect(root.querySelectorAll("circle").length).toBe(zone.properties.cityPoints.length + zone.properties.townPoints.filter(within).length);
  });

  // The outline is roads: the map says which.
  it("names the long roads its line follows, and carries a mile bar", () => {
    const named = text.filter((t) => zone.properties.roads.includes(t ?? ""));
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const road of named) expect(LOOP_ROADS.some((r) => r.loop === id && r.road === road)).toBe(true);
    expect(text).toContain("5 mi");
  });

  it("draws this zone only, in its color, over a dark casing", () => {
    expect(svg).toContain(`fill="${REGION_COLOR[id]}" fill-opacity="0.18"`);
    expect(svg).toContain('stroke="var(--c-night)"');
    for (const other of REGION_IDS.filter((o) => o !== id)) expect(svg).not.toContain(REGION_COLOR[other]);
  });

  it("fits the zone's bounds, which hold its loop and every city", () => {
    const [[west, south], [east, north]] = zoneBounds(id);
    for (const [lon, lat] of [...zone.geometry.coordinates[0]!, ...zone.properties.cityPoints.map((c) => [c.lon, c.lat] as const)]) {
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    const [[sw, ss], [se, sn]] = COLORADO_BOUNDS;
    expect(west).toBeGreaterThan(sw);
    expect(east).toBeLessThan(se);
    expect(south).toBeGreaterThan(ss);
    expect(north).toBeLessThan(sn);
  });
});

// A Why Colorado card's header: the zone at 16:9, with a state locator.
describe.each(REGION_IDS)("coloradoMapSvg thumbnail of %s", (id) => {
  const zone = zoneById(id);
  const { frame } = viewOf({ zone: id, variant: "thumb" });
  const svg = coloradoMapSvg({ label: "Thumb label", description: "Thumb description" }, { zone: id, variant: "thumb" });
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;
  const text = [...root.querySelectorAll("text")].map((t) => t.textContent);

  it("is a 16:9 picture that names the zone's cities and nothing else", () => {
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${frame.width} ${frame.height}`);
    expect(text.sort()).toEqual(zone.properties.cityPoints.map((c) => c.name).sort());
  });

  it("shows where the zone is in the state", () => {
    // The locator: a rounded box with the state's outline and one dot in the region's color.
    expect(root.querySelectorAll("rect[rx]")).toHaveLength(1);
    expect(root.querySelectorAll(`circle[fill="${REGION_COLOR[id]}"]`)).toHaveLength(1);
  });
});

// /maps/colorado.svg and /maps/<region>.svg: a map as one standalone file.
describe.each([undefined, ...REGION_IDS])("mapFileSvg(%s)", (zone) => {
  const svg = mapFileSvg(zone);
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;

  it("is one well-formed SVG that needs nothing from the site", () => {
    expect(root.nodeName).toBe("svg");
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    // Every token is resolved, and the relief travels inside the file.
    expect(svg).not.toContain("var(--");
    expect(root.querySelector("image")?.getAttribute("href")).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("paints in real colors: the wash's stops and every fill and stroke a token gave", () => {
    const stops = [...root.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color"));
    expect(stops).toHaveLength(3);
    for (const color of stops) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(svg).not.toMatch(/NaN|undefined|\[object/);
  });

  it("names itself, and credits its sources", () => {
    expect(root.getAttribute("aria-label")).toMatch(/^Map of /);
    expect(root.querySelector("title")?.textContent).toBe(root.getAttribute("aria-label"));
    expect(svg).toContain("Roads: US Census Bureau");
    expect(svg).toContain("Relief: USGS");
  });

  it("draws the same view the site does", () => {
    const { frame } = viewOf({ zone });
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${frame.width} ${frame.height}`);
    const names = zone ? zoneById(zone).properties.cities : ZONES.features.map((z) => z.properties.name);
    for (const name of names) expect(svg, name).toContain(name);
  });
});

describe("zoneById", () => {
  it("throws for a zone the data lacks, so a page never draws an empty map", () => {
    expect(() => zoneById("nowhere" as never)).toThrow(/no zone "nowhere"/);
  });
});
