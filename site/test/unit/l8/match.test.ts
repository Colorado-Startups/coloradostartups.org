// L8: regionForCity() and the region data it reads. Core cities, nearby
// cities and unknown cities, as the lane file asks, plus the data rules that
// keep the lookup unambiguous.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REGION_IDS, type Region } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { COLORADO_PLACES } from "../../../src/lib/leaderboard/places";
import { cityKey, ELSEWHERE, parseRegions, REGIONS, regionForCity } from "../../../src/lib/regions/match";
import { INSIDE_A_CANYON } from "./canyon-rule";

const DATA = fileURLToPath(new URL("../../../../data/regions/", import.meta.url));
const yamlOf = (id: string) => parse(readFileSync(path.join(DATA, `${id}.yaml`), "utf8")) as Record<string, unknown>;

describe("REGIONS", () => {
  it("loads the three regions from data/regions/ in display order", () => {
    expect(REGIONS.map((r) => r.id)).toEqual(["photon-mountain", "space-peak", "fusion-canyon"]);
    expect(REGIONS.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("keeps the core cities Paul named (decision 45)", () => {
    const cities = Object.fromEntries(REGIONS.map((r) => [r.id, r.cities]));
    expect(cities).toEqual({
      "photon-mountain": ["Boulder", "Golden", "Arvada", "Denver"],
      "space-peak": ["Colorado Springs"],
      "fusion-canyon": ["Fort Collins", "Loveland", "Windsor", "Greeley"],
    });
  });

  it("can place every core city on the map", () => {
    for (const r of REGIONS) for (const city of r.cities) expect(COLORADO_PLACES[city], city).toBeDefined();
  });
});

describe("regionForCity", () => {
  it.each([
    ["Boulder", "photon-mountain"],
    ["Golden", "photon-mountain"],
    ["Arvada", "photon-mountain"],
    ["Denver", "photon-mountain"],
    ["Colorado Springs", "space-peak"],
    ["Fort Collins", "fusion-canyon"],
    ["Loveland", "fusion-canyon"],
    ["Windsor", "fusion-canyon"],
    ["Greeley", "fusion-canyon"],
  ])("maps the core city %s to %s", (city, region) => {
    expect(regionForCity(city)).toBe(region);
  });

  it.each([
    ["Louisville", "photon-mountain"],
    ["Longmont", "photon-mountain"],
    ["Centennial", "photon-mountain"],
    ["Castle Rock", "photon-mountain"],
    ["Monument", "space-peak"],
    ["Manitou Springs", "space-peak"],
    ["Cascade", "space-peak"],
    ["Timnath", "fusion-canyon"],
    ["Estes Park", "fusion-canyon"],
  ])("maps the nearby city %s to %s", (city, region) => {
    expect(regionForCity(city)).toBe(region);
  });

  it("ignores case, extra spaces and a trailing Colorado", () => {
    expect(regionForCity("  boulder ")).toBe("photon-mountain");
    expect(regionForCity("Fort   Collins")).toBe("fusion-canyon");
    expect(regionForCity("Denver, CO")).toBe("photon-mountain");
    expect(regionForCity("Colorado Springs, Colorado")).toBe("space-peak");
  });

  // The default fallback (fallbackRegion in src/lib/regions/match.ts; Paul's
  // rule is a Project 2 card). When Paul writes his own rule, these cases
  // change with it.
  it.each(["Durango", "Grand Junction", "Pueblo", "Frederick", "Bailey", "Nowhere Junction"])(
    "sends the unlisted city %s to elsewhere",
    (city) => {
      expect(regionForCity(city)).toBe(ELSEWHERE);
    },
  );

  it("keeps out-of-state headquarters elsewhere, even when they name a Colorado city", () => {
    expect(regionForCity("Seattle, WA")).toBe(ELSEWHERE);
    expect(regionForCity("Bentonville, AR, with a Denver engineering team")).toBe(ELSEWHERE);
  });

  it("treats statewide, online and empty values as no city", () => {
    expect(regionForCity("statewide")).toBe(ELSEWHERE);
    expect(regionForCity("online")).toBe(ELSEWHERE);
    expect(regionForCity("   ")).toBe(ELSEWHERE);
  });

  it("reads the lists it is given", () => {
    const one: Region[] = [{ ...REGIONS[0]!, cities: ["Pueblo"], nearby: [] }];
    expect(regionForCity("Pueblo", one)).toBe("photon-mountain");
    expect(regionForCity("Denver", one)).toBe(ELSEWHERE);
  });
});

describe("parseRegions", () => {
  const docs = REGION_IDS.map(yamlOf);

  it("accepts the real files", () => {
    expect(parseRegions(docs).map((r) => r.id)).toEqual(["photon-mountain", "space-peak", "fusion-canyon"]);
  });

  it("refuses a city listed by two regions", () => {
    const clash = docs.map((d) => (d.id === "space-peak" ? { ...d, nearby: ["Boulder"] } : d));
    expect(() => parseRegions(clash)).toThrow(/"Boulder" is listed by both photon-mountain and space-peak/);
  });

  it("refuses the same city spelled two ways", () => {
    const clash = docs.map((d) => (d.id === "fusion-canyon" ? { ...d, nearby: ["denver, co"] } : d));
    expect(() => parseRegions(clash)).toThrow(/listed by both/);
  });

  it("refuses a missing or repeated region", () => {
    expect(() => parseRegions(docs.slice(0, 2))).toThrow(/exactly one file per region/);
    expect(() => parseRegions([...docs, docs[0]])).toThrow(/exactly one file per region/);
  });

  it("validates each file with RegionSchema", () => {
    const bad = docs.map((d) => (d.id === "space-peak" ? { ...d, cities: [] } : d));
    expect(() => parseRegions(bad)).toThrow();
  });
});

describe("cityKey", () => {
  it("normalizes spacing, case and a trailing state", () => {
    expect(cityKey(" Fort  Collins ")).toBe("fort collins");
    expect(cityKey("Denver, Colorado")).toBe("denver");
    expect(cityKey("Seattle, WA")).toBe("seattle, wa");
  });
});

describe("Fusion Canyon copy", () => {
  const fc = yamlOf("fusion-canyon");

  it("never places the region inside a canyon", () => {
    for (const field of ["tagline", "summary"]) expect(String(fc[field]), field).not.toMatch(INSIDE_A_CANYON);
  });

  it("says it is named for the canyon and built on the plain", () => {
    expect(String(fc.summary)).toMatch(/named for the canyon and built on the plain/i);
    expect(String(fc.note)).toMatch(/^Named for the canyon\. Built on the plain\./);
  });

  it("has a rule that catches the phrasing it forbids", () => {
    expect("Founders building in the canyon.").toMatch(INSIDE_A_CANYON);
    expect("Startups line the canyon walls.").toMatch(INSIDE_A_CANYON);
    expect("Named for the canyon. Built on the plain.").not.toMatch(INSIDE_A_CANYON);
  });
});
