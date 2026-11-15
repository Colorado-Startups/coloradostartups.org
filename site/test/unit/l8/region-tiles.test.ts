// The region pages' four figures (components/regions/region-tiles.ts): each
// is a fact from data/positions/facts.yaml, shown with its own value and
// source line, so no region page shows an unsourced figure.
import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { REGION_TILES, regionTiles } from "../../../src/components/regions/region-tiles";
import { factById, loadFacts } from "../../../src/lib/seats/load";

const facts = loadFacts();

describe.each(REGION_IDS)("%s tiles", (id) => {
  const tiles = regionTiles(id);

  it("are four, each one fact's value with that fact's source line", () => {
    expect(tiles).toHaveLength(4);
    for (const [i, [factId]] of REGION_TILES[id].entries()) {
      const fact = factById(facts, factId);
      expect(tiles[i]!.value).toBe(String(fact.value));
      expect(tiles[i]!.source).toBe(fact.short);
      expect(tiles[i]!.source.length).toBeGreaterThan(0);
    }
  });

  it("use no em dash or spaced en dash", () => {
    for (const t of tiles) expect(`${t.value} ${t.label} ${t.source}`).not.toMatch(/—| – /);
  });
});

it("shows each fact on one region page only", () => {
  const ids = Object.values(REGION_TILES).flatMap((tiles) => tiles.map(([factId]) => factId));
  expect(new Set(ids).size).toBe(ids.length);
});
