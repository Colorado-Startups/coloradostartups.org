// L38: the volunteer kit's copy in data/positions/ agrees with the site's own
// seat contract. data/team/positions.yaml (L9) and REQUIRED_COURSES in
// packages/shared/src/apply.ts (L19) stay the source for /get-involved/ and
// the form; this lane never edits them. A mismatch fails here, and the lane
// reports it as a QUESTION to the orchestrator instead of editing the other
// file. The comparison is one function, run first on a known-good and a
// known-bad sample, then on the real files.
import { readFileSync } from "node:fs";

import { PositionSchema, REQUIRED_COURSES, type Position } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { takesApplications } from "../../../src/components/positions/positions";
import { regionForCity, REGIONS } from "../../../src/lib/regions/match";
import { hasLayout, layoutRefs, SEAT_LAYOUTS } from "../../../src/lib/seats/layouts";
import { loadCommon, loadFacts, loadGeo, loadSeats, type Seat } from "../../../src/lib/seats/load";

type Required = Readonly<Record<string, readonly string[]>>;

/** What disagrees between the kit's seats and the site's; empty when they agree. */
function contractProblems(
  kitSeats: readonly Pick<Seat, "id" | "title" | "extra_courses">[],
  coreCourses: readonly string[],
  positions: readonly Position[],
  required: Required,
): string[] {
  const problems: string[] = [];
  const applySeats = positions.filter((p) => p.apply !== undefined);
  const kitIds = kitSeats.map((s) => s.id).sort();
  const siteIds = applySeats.map((p) => p.id).sort();
  if (JSON.stringify(kitIds) !== JSON.stringify(siteIds)) {
    problems.push(`seat ids: data/positions/ has [${kitIds.join(", ")}], positions.yaml's apply seats are [${siteIds.join(", ")}]`);
  }
  for (const seat of kitSeats) {
    const position = positions.find((p) => p.id === seat.id);
    if (position && position.title !== seat.title) problems.push(`${seat.id}: title "${seat.title}" here, "${position.title}" in positions.yaml`);
    const courses = [...coreCourses, ...seat.extra_courses];
    const want = required[seat.id];
    if (!want) problems.push(`${seat.id}: no REQUIRED_COURSES entry`);
    else if (JSON.stringify(courses) !== JSON.stringify([...want])) {
      problems.push(`${seat.id}: courses [${courses.join(", ")}] here, REQUIRED_COURSES says [${want.join(", ")}]`);
    }
  }
  return problems;
}

const positions = (parse(readFileSync(new URL("../../../../data/team/positions.yaml", import.meta.url), "utf8")) as unknown[]).map((p) =>
  PositionSchema.parse(p),
);
const seats = loadSeats();
const common = loadCommon();

const position = (over: Partial<Position>): Position =>
  PositionSchema.parse({
    id: "a-seat",
    title: "A Seat",
    area: "community",
    summary: "A seeded seat.",
    what_you_do: ["Welcome people."],
    status: "open",
    apply: { open: true, courses: ["claude-101"] },
    ...over,
  });

describe("contractProblems (self-test)", () => {
  const good = { id: "a-seat", title: "A Seat", extra_courses: ["ai-fluency-for-small-businesses" as const] };
  const required = { "a-seat": ["claude-101", "ai-fluency-for-small-businesses"] };

  it("passes a kit that agrees with the site (known clean)", () => {
    expect(contractProblems([good], ["claude-101"], [position({})], required)).toEqual([]);
  });

  it("flags a seat id, a title and a course list that disagree (known bad)", () => {
    const bad = { ...good, id: "a-seat", title: "A Renamed Seat", extra_courses: [] };
    const problems = contractProblems([bad, { ...good, id: "stray-seat" }], ["claude-101"], [position({})], required);
    expect(problems.some((p) => p.startsWith("seat ids:"))).toBe(true);
    expect(problems).toContain('a-seat: title "A Renamed Seat" here, "A Seat" in positions.yaml');
    expect(problems.some((p) => p.startsWith("a-seat: courses"))).toBe(true);
    expect(problems).toContain("stray-seat: no REQUIRED_COURSES entry");
  });
});

describe("data/positions/ against positions.yaml and REQUIRED_COURSES", () => {
  it("names the four seats, the same titles and the same courses", () => {
    expect(contractProblems(seats, common.core_courses, positions, REQUIRED_COURSES)).toEqual([]);
    expect(seats.map((s) => s.id).sort()).toEqual(
      ["fusion-canyon-connector", "photon-mountain-connector", "slack-community-lead", "space-peak-connector"],
    );
  });

  it("matches only seats that take applications today, so every seat page has a form to send people to", () => {
    for (const seat of seats) expect(takesApplications(positions.find((p) => p.id === seat.id)!), seat.id).toBe(true);
  });
});

describe("the layouts and the synced data", () => {
  const facts = loadFacts();

  it("gives every seat a layout, and nothing else", () => {
    expect(Object.keys(SEAT_LAYOUTS).sort()).toEqual(seats.map((s) => s.id).sort());
    for (const seat of seats) expect(hasLayout(seat.id)).toBe(true);
  });

  it("cites only facts the sync kept, so no layout can show a gated or S-marked figure", () => {
    for (const [id, layout] of Object.entries(SEAT_LAYOUTS)) {
      for (const ref of layoutRefs(layout).filter((r) => r !== "courses")) expect(facts, `${id} cites ${ref}`).toHaveProperty(ref);
    }
  });

  it("parses the map data, with each outpost's cities on it", () => {
    const geo = loadGeo();
    for (const region of ["photon-mountain", "fusion-canyon", "space-peak"]) {
      expect(geo.cities.filter((c) => c.region === region && c.core).length, region).toBeGreaterThan(0);
    }
  });

  // data/regions/ is the source for which cities are core (decision 45, #180).
  it("marks exactly data/regions' core cities as core on the seat maps, each in its own region", () => {
    const geo = loadGeo();
    const core = geo.cities.filter((c) => c.core).map((c) => `${c.name}:${c.region}`);
    expect(core.sort()).toEqual(REGIONS.flatMap((r) => r.cities.map((city) => `${city}:${r.id}`)).sort());
  });

  it("puts every map city in the region data/regions/ gives it", () => {
    for (const c of loadGeo().cities) expect(regionForCity(c.name), c.name).toBe(c.region);
  });

  it("names only core cities as the statewide map's hubs, one or more per region", () => {
    const hubs = loadGeo().cities.filter((c) => c.hub);
    for (const c of hubs) expect(c.core, c.name).toBe(true);
    expect(new Set(hubs.map((c) => c.region)).size).toBe(REGIONS.length);
  });

  it("takes three steps from roles.json, and step 3 promises an interview only if it looks like a fit", () => {
    expect(common.steps).toHaveLength(3);
    expect(common.steps[2]!.body).toContain("If it looks like a fit, Paul sets up an interview");
  });
});
