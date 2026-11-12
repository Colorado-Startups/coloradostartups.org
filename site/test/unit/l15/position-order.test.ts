// L15: comparePositions() in @cs/shared is the one position sort. It orders
// by area (community, region, project), then region order from
// data/regions/*.yaml, then title. /get-involved/ and L1's /community/ both
// sort with it.
import { readFileSync } from "node:fs";
import path from "node:path";

import { comparePositions, type Position, PositionSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { REGIONS } from "../../../src/lib/regions/match";

const seat = (id: string, title: string, area: Position["area"], region?: string): Position => ({
  id,
  title,
  area,
  ...(region && { region }),
  summary: "A seat for a person in the community.",
  what_you_do: ["Help founders."],
  status: "open",
});

const ids = (positions: Position[]) => positions.map((p) => p.id);

describe("comparePositions", () => {
  const regions = [
    { id: "north", order: 1 },
    { id: "south", order: 2 },
  ];

  it("puts community seats first, then region seats, then projects", () => {
    const got = [
      seat("p", "A project", "project"),
      seat("r", "A region", "region", "north"),
      seat("c", "Zebra community seat", "community"),
    ].sort(comparePositions(regions));
    expect(ids(got)).toEqual(["c", "r", "p"]);
  });

  it("orders region seats by the region's order, not by title or id", () => {
    const got = [seat("a-south", "Alpha organizer", "region", "south"), seat("z-north", "Zulu organizer", "region", "north")].sort(
      comparePositions(regions),
    );
    expect(ids(got)).toEqual(["z-north", "a-south"]);
  });

  it("reads the region order it is given, so a YAML change reorders the seats", () => {
    const flipped = [
      { id: "north", order: 2 },
      { id: "south", order: 1 },
    ];
    const got = [seat("n", "North organizer", "region", "north"), seat("s", "South organizer", "region", "south")].sort(
      comparePositions(flipped),
    );
    expect(ids(got)).toEqual(["s", "n"]);
  });

  it("breaks ties by title inside an area", () => {
    const got = [
      seat("slack", "Slack Community Lead", "community"),
      seat("linkedin", "LinkedIn Group moderator", "community"),
      seat("statewide", "Community organizer, statewide", "community"),
    ].sort(comparePositions(regions));
    expect(ids(got)).toEqual(["statewide", "linkedin", "slack"]);
  });

  it("puts a seat whose region is not in the list after the known regions", () => {
    const got = [seat("unknown", "Aardvark organizer", "region", "nowhere"), seat("south", "South organizer", "region", "south")].sort(
      comparePositions(regions),
    );
    expect(ids(got)).toEqual(["south", "unknown"]);
  });
});

describe("comparePositions over data/team/positions.yaml", () => {
  const file = path.resolve(import.meta.dirname, "../../../../data/team/positions.yaml");
  const positions = (parse(readFileSync(file, "utf8")) as unknown[]).map((p) => PositionSchema.parse(p));

  it("lists the eight seats in the order /get-involved/ shows them", () => {
    expect(ids([...positions].sort(comparePositions(REGIONS)))).toEqual([
      "community-organizer",
      "linkedin-moderator",
      "slack-community-lead",
      "photon-mountain-connector",
      "space-peak-connector",
      "fusion-canyon-connector",
      "resources-curator",
      "startupers-contributor",
    ]);
  });
});
