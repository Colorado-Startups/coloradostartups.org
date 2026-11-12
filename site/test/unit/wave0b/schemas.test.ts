// Wave 0b contracts (decisions 43 to 45): agent kinds, open positions and
// regions. These read the real data files, so a bad seed fails here first.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DwarfSchema, PositionSchema, REGION_IDS, RegionSchema } from "@cs/shared";

const DATA = new URL("../../../../data/", import.meta.url);
const read = (rel: string) => parse(readFileSync(new URL(rel, DATA), "utf8")) as unknown;

describe("keepers: dwarves and gnomes", () => {
  const keepers = (read("team/dwarves.yaml") as unknown[]).map((d) => DwarfSchema.parse(d));

  it("has at least one gnome and one dwarf", () => {
    const kinds = new Set(keepers.map((k) => k.kind));
    expect(kinds.has("gnome")).toBe(true);
    expect(kinds.has("dwarf")).toBe(true);
  });

  it("makes Resourcus the gnome", () => {
    expect(keepers.find((k) => k.id === "resourcus")?.kind).toBe("gnome");
  });

  it("points every portrait at the agents art folder", () => {
    for (const k of keepers) expect(k.portrait).toBe(`agents/${k.id}`);
  });

  it("refuses a keeper with no kind", () => {
    const { kind: _kind, ...noKind } = keepers[0]!;
    expect(DwarfSchema.safeParse(noKind).success).toBe(false);
  });
});

describe("open positions", () => {
  const positions = (read("team/positions.yaml") as unknown[]).map((p) => PositionSchema.parse(p));

  it("seeds the six seats Paul named plus the project roles", () => {
    const ids = positions.map((p) => p.id);
    for (const id of [
      "slack-community-lead",
      "linkedin-moderator",
      "community-organizer",
      "photon-mountain-connector",
      "space-peak-connector",
      "fusion-canyon-connector",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("gives every region exactly one organizer", () => {
    for (const region of REGION_IDS) {
      expect(positions.filter((p) => p.region === region)).toHaveLength(1);
    }
  });

  const open = {
    id: "x",
    title: "Test seat",
    area: "community",
    summary: "A seat used only by this test.",
    what_you_do: ["Test things."],
    status: "open",
  };

  it("accepts an open position with no holder", () => {
    expect(PositionSchema.safeParse(open).success).toBe(true);
  });

  it("refuses an open position that names a holder", () => {
    expect(PositionSchema.safeParse({ ...open, holder: "someone" }).success).toBe(false);
  });

  it("refuses a filled position with no holder", () => {
    expect(PositionSchema.safeParse({ ...open, status: "filled" }).success).toBe(false);
  });

  it("refuses a region position with no region", () => {
    expect(PositionSchema.safeParse({ ...open, area: "region" }).success).toBe(false);
  });
});

describe("regions", () => {
  const files = readdirSync(new URL("regions/", DATA)).filter((f) => f.endsWith(".yaml"));
  const regions = files.map((f) => RegionSchema.parse(read(`regions/${f}`)));

  it("has one file per region id, named by id", () => {
    expect(regions.map((r) => r.id).sort()).toEqual([...REGION_IDS].sort());
    for (const f of files) expect(regions.some((r) => `${r.id}.yaml` === f)).toBe(true);
  });

  it("never lists a city in two regions", () => {
    const seen = new Map<string, string>();
    for (const r of regions) {
      for (const city of [...r.cities, ...r.nearby]) {
        expect(seen.get(city), `${city} is in ${seen.get(city)} and ${r.id}`).toBeUndefined();
        seen.set(city, r.id);
      }
    }
  });

  it("keeps the Fusion Canyon rule in its note", () => {
    const fc = regions.find((r) => r.id === "fusion-canyon");
    expect(fc?.note).toContain("Built on the plain");
  });
});
