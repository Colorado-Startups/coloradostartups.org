// The statewide map's geography (data/geo/, built by scripts/geo/build.mjs):
// each zone is the loop its named roads close, about Silicon Valley's size.
// And its build-time drawing (lib/regions/colorado-map.ts).
import { readFileSync } from "node:fs";
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
import { COLORADO, COLORADO_BOUNDS, DIM, ZONES, zoneBounds, zoneById } from "../../../src/lib/regions/colorado-geo";
import { clockwise, coloradoMapSvg, signedArea } from "../../../src/lib/regions/colorado-map";
import { REGION_COLORS as REGION_COLOR } from "../../../src/lib/regions/map";

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
  it("matches what roads.geojson builds to, and is a real loop", () => {
    expect(readFileSync(path.join(ROOT, "data/geo/silicon-valley.geojson"), "utf8")).toBe(format(buildYardstick(roads)));
    expect(yardstick.area_sq_mi).toBeGreaterThan(50);
    expect(yardstick.span_mi).toBeGreaterThan(10);
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

describe("coloradoMapSvg", () => {
  const svg = coloradoMapSvg({ label: "Map label", description: "Map description" });
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;

  it("is one labelled image to assistive tech", () => {
    expect(root.getAttribute("role")).toBe("img");
    expect(svg).toContain("Map label");
  });

  it("names all three zones and dots every core city", () => {
    const text = [...root.querySelectorAll("text")].map((t) => t.textContent);
    for (const z of ZONES.features) expect(text, z.id).toContain(z.properties.name);
    const cities = ZONES.features.flatMap((z) => z.properties.cityPoints).length;
    expect(root.querySelectorAll("circle").length).toBe(cities);
  });

  // d3-geo needs clockwise exterior rings; a counterclockwise one fills the globe.
  it("hands Plot clockwise rings, so each shape is the shape and not the globe around it", () => {
    for (const f of [...COLORADO.features, ...ZONES.features]) {
      expect(signedArea(clockwise(f).geometry.coordinates[0]!), f.id).toBeLessThan(0);
    }
  });

  it("fits the zones inside the drawing, well short of its edges", () => {
    const paths = [...root.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
    const xs = paths.flatMap((d) => [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => Number(m[1])));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(640);
  });

  it("draws in the region tokens, never a hex", () => {
    expect(svg).toMatch(/var\(--c-accent-deep\)/);
    expect(svg).toMatch(/var\(--c-community\)/);
    expect(svg).toMatch(/var\(--c-fire\)/);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

// A region page's map: the drawing zoomed to one zone, the other two dimmed,
// as the live map does it (colorado-map.client.ts reads the same DIM).
describe.each(REGION_IDS)("coloradoMapSvg zoomed to %s", (id) => {
  const zone = zoneById(id);
  const svg = coloradoMapSvg({ label: "Zone label", description: "Zone description" }, { zone: id });
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;
  const text = [...root.querySelectorAll("text")].map((t) => t.textContent);

  it("is one labelled image", () => {
    expect(root.getAttribute("role")).toBe("img");
    expect(svg).toContain("Zone label");
  });

  it("dots and names only the zone's core cities", () => {
    expect(root.querySelectorAll("circle").length).toBe(zone.properties.cityPoints.length);
    expect(text.sort()).toEqual(zone.properties.cityPoints.map((c) => c.name).sort());
  });

  it("dims the other two zones and draws this one at full strength", () => {
    expect(svg.match(new RegExp(`fill-opacity="${DIM.fill}"`, "g"))).toHaveLength(2);
    expect(svg.match(new RegExp(`stroke-opacity="${DIM.line}"`, "g"))).toHaveLength(2);
    expect(svg).toContain(`fill="${REGION_COLOR[id]}" fill-opacity="0.18"`);
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

describe("zoneById", () => {
  it("throws for a zone the data lacks, so a page never draws an empty map", () => {
    expect(() => zoneById("nowhere" as never)).toThrow(/no zone "nowhere"/);
  });
});
