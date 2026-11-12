// #147: the nomination form fills in the county from the city. Every city the
// site already names must have its counties, and every county must be one the
// form's select offers.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { COLORADO_COUNTIES } from "../../../src/lib/leaderboard/counties";
import { countiesForCity, listedCity, PLACE_COUNTIES } from "../../../src/lib/leaderboard/place-counties";
import { COLORADO_PLACES } from "../../../src/lib/leaderboard/places";

const REGIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/regions");

function regionCities(): string[] {
  return readdirSync(REGIONS)
    .filter((f) => f.endsWith(".yaml"))
    .flatMap((f) => {
      const r = parse(readFileSync(path.join(REGIONS, f), "utf8")) as { cities?: string[]; nearby?: string[] };
      return [...(r.cities ?? []), ...(r.nearby ?? [])];
    });
}

describe("PLACE_COUNTIES", () => {
  it("covers every Colorado HQ city on the Leaderboard map", () => {
    const missing = Object.keys(COLORADO_PLACES).filter((city) => countiesForCity(city).length === 0);
    expect(missing).toEqual([]);
  });

  it("covers every core and nearby city in data/regions/", () => {
    const cities = regionCities();
    expect(cities.length).toBeGreaterThan(10);
    expect(cities.filter((city) => countiesForCity(city).length === 0)).toEqual([]);
  });

  it("names only counties the form's select offers, each once per city", () => {
    const known = new Set<string>(COLORADO_COUNTIES);
    for (const [city, counties] of Object.entries(PLACE_COUNTIES)) {
      expect(counties.length, city).toBeGreaterThan(0);
      expect(new Set(counties).size, city).toBe(counties.length);
      expect(counties.filter((c) => !known.has(c)), city).toEqual([]);
    }
  });
});

describe("countiesForCity", () => {
  it("matches a city however it is typed", () => {
    expect(countiesForCity("  fort   collins ")).toEqual(["Larimer"]);
    expect(countiesForCity("COLORADO SPRINGS")).toEqual(["El Paso"]);
  });

  it("lists every county of a city in more than one", () => {
    expect(countiesForCity("Aurora")).toEqual(["Adams", "Arapahoe", "Douglas"]);
    expect(countiesForCity("Longmont")).toEqual(["Boulder", "Weld"]);
  });

  it("gives the listed spelling of a city typed another way", () => {
    expect(listedCity(" aurora ")).toBe("Aurora");
    expect(listedCity("Seattle")).toBeUndefined();
  });

  it("knows nothing of a city it does not list", () => {
    expect(countiesForCity("Seattle")).toEqual([]);
    expect(countiesForCity("")).toEqual([]);
  });
});
