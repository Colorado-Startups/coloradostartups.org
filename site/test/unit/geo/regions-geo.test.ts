// The statewide map's geography (data/geo/, built by scripts/geo/build.mjs)
// and its build-time drawing (lib/regions/colorado-map.ts).
import { readFileSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { buildRegions, findPlace, insideRing, readPlaces, readRegions, ringsOverlap } from "../../../../scripts/geo/build.mjs";
import { COLORADO, COLORADO_BOUNDS, ZONES } from "../../../src/lib/regions/colorado-geo";
import { clockwise, coloradoMapSvg, signedArea } from "../../../src/lib/regions/colorado-map";

const ROOT = path.join(__dirname, "../../../..");
const places = readPlaces(path.join(ROOT, "data/geo/places.csv"));
const regions = readRegions(path.join(ROOT, "data/regions"));

describe("data/geo/regions.geojson", () => {
  // The same check as `node scripts/geo/build.mjs --check`, in CI.
  it("matches what data/regions and places.csv build to (run scripts/geo/build.mjs if not)", () => {
    const want = `${JSON.stringify(buildRegions(places, regions), null, 1)}\n`;
    expect(readFileSync(path.join(ROOT, "data/geo/regions.geojson"), "utf8")).toBe(want);
  });

  it("has one zone per region, in the shared region ids", () => {
    expect(ZONES.features.map((z) => z.id).sort()).toEqual([...REGION_IDS].sort());
  });

  it("puts every city and nearby town inside its own zone", () => {
    for (const r of regions) {
      const ring = ZONES.features.find((z) => z.id === r.id)!.geometry.coordinates[0]!;
      for (const town of [...r.cities, ...(r.nearby ?? [])]) {
        const p = findPlace(places, town)!;
        expect(insideRing([p.lon, p.lat], ring), `${town} in ${r.id}`).toBe(true);
      }
    }
  });

  it("keeps the zones apart", () => {
    const rings = ZONES.features.map((z) => z.geometry.coordinates[0]!);
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) expect(ringsOverlap(rings[i], rings[j])).toBe(false);
  });

  it("says each zone is a proposal, not a legal line", () => {
    for (const z of ZONES.features) expect(z.properties.note).toMatch(/proposal, not a legal line/);
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
