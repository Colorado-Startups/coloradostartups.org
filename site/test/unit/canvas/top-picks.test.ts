// L1a: topPicks(), the 12 picks Startup Resources opens on (L1b renders them).
// Determinism, the count, the spread rules, the region bias, short stages and
// an empty list. The fixture mirrors the real mix: Denver and Boulder heavy,
// a statewide share in every stage, the types each stage actually holds.
import { STAGES, type ResourceCard, type Stage } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { FIRST_NEED, topPicks } from "../../../src/components/canvas/top-picks";

type Type = ResourceCard["type"];

const SUBSTAGE: Record<Stage, string> = {
  idea: "educate",
  launch: "develop",
  growth: "investors",
  support: "organizations",
};

function card(stage: Stage, name: string, type: Type, city: string): ResourceCard {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { id, name, url: `https://example.org/${id}`, stage, substage: SUBSTAGE[stage], city, type, description: "One line." };
}

const FIXTURE: ResourceCard[] = [
  card("idea", "Denver Founders Meetup", "community", "Denver"),
  card("idea", "Boulder Startup Circle", "community", "Boulder"),
  card("idea", "Colorado Founder Network", "community", "statewide"),
  card("idea", "Startup Basics Course", "education", "statewide"),
  card("idea", "Springs Idea Lab", "education", "Colorado Springs"),
  card("idea", "Pitch Night Denver", "event", "Denver"),
  card("idea", "Statewide Startup Week", "event", "statewide"),
  card("idea", "Founder Stories Podcast", "media", "online"),
  card("idea", "Fort Collins Makers", "community", "Fort Collins"),
  card("launch", "Front Range Accelerator", "accelerator", "Boulder"),
  card("launch", "Denver Venture Lab", "accelerator", "Denver"),
  card("launch", "Colorado Seed Fund", "investor", "statewide"),
  card("launch", "Peak Angels", "investor", "Denver"),
  card("launch", "Startup Law Group", "service-provider", "statewide"),
  card("launch", "Boulder Desk Co", "coworking", "Boulder"),
  card("launch", "Springs Incubator", "incubator", "Colorado Springs"),
  card("launch", "Loveland Launchpad", "incubator", "Loveland"),
  card("launch", "Fort Collins Coworking", "coworking", "Fort Collins"),
  card("growth", "Growth Capital Partners", "investor", "statewide"),
  card("growth", "Denver Growth Fund", "investor", "Denver"),
  card("growth", "Scale Accounting", "service-provider", "statewide"),
  card("growth", "Boulder Recruiting", "service-provider", "Boulder"),
  card("growth", "Colorado Business News", "media", "statewide"),
  card("growth", "Springs Scale Program", "accelerator", "Colorado Springs"),
  card("support", "State Office of Economic Development", "government", "statewide"),
  card("support", "City of Denver Business Office", "government", "Denver"),
  card("support", "University Venture Office", "university", "Boulder"),
  card("support", "Founders Nonprofit", "nonprofit", "statewide"),
  card("support", "Springs Chamber", "other", "Colorado Springs"),
  card("support", "Fort Collins Innovation Hub", "university", "Fort Collins"),
];

const FUSION_CANYON = { cities: ["Fort Collins", "Loveland", "Windsor"], nearby: ["Greeley", "Estes Park"] };

const names = (result: ReturnType<typeof topPicks>) => result.map((s) => s.picks.map((p) => p.card.name));
const LOCAL = new Set(["statewide", "online"]);

describe("topPicks", () => {
  it("gives the same output for the same input, whatever the input order", () => {
    const first = topPicks(FIXTURE);
    expect(topPicks(FIXTURE)).toEqual(first);
    expect(topPicks([...FIXTURE].reverse())).toEqual(first);
    const shuffled = [...FIXTURE].sort((a, b) => (a.url.length % 7) - (b.url.length % 7) || b.id.localeCompare(a.id));
    expect(topPicks(shuffled)).toEqual(first);
  });

  it("returns 3 picks for each of the 4 stages, 12 in all, in journey order", () => {
    const result = topPicks(FIXTURE);
    expect(result.map((s) => s.stage)).toEqual([...STAGES]);
    for (const s of result) {
      expect(s.picks).toHaveLength(3);
      for (const p of s.picks) expect(p.card.stage).toBe(s.stage);
    }
    expect(result.flatMap((s) => s.picks)).toHaveLength(12);
  });

  it("puts statewide reach first, then the stage's first-need types", () => {
    const [idea, launch, growth, support] = topPicks(FIXTURE);
    expect(idea.picks.map((p) => p.card.name)).toEqual([
      "Startup Basics Course",
      "Colorado Founder Network",
      "Statewide Startup Week",
    ]);
    expect(idea.picks.every((p) => p.reason === "statewide")).toBe(true);
    // Launch has two statewide cards; the third slot goes to its first-need type.
    expect(launch.picks.map((p) => p.card.name)).toEqual([
      "Colorado Seed Fund",
      "Startup Law Group",
      "Denver Venture Lab",
    ]);
    expect(launch.picks.map((p) => p.reason)).toEqual(["statewide", "statewide", "first-need"]);
    expect(growth.picks[0].card.type).toBe(FIRST_NEED.growth[0]);
    expect(support.picks[0].card.name).toBe("State Office of Economic Development");
  });

  it("never repeats a type in a stage while another type is left", () => {
    for (const s of topPicks(FIXTURE)) {
      expect(new Set(s.picks.map((p) => p.card.type)).size).toBe(s.picks.length);
    }
  });

  it("repeats a type only when the stage has too few types", () => {
    const cards = [
      card("idea", "Alpha Community", "community", "Denver"),
      card("idea", "Beta Community", "community", "Boulder"),
      card("idea", "Gamma Course", "education", "Denver"),
    ];
    const [idea] = topPicks(cards);
    expect(idea.picks).toHaveLength(3);
    expect(idea.picks.map((p) => p.card.type).sort()).toEqual(["community", "community", "education"]);
  });

  it("spreads local picks across cities, within a stage and across stages", () => {
    const local = (stage: Stage, n: number, city: string) =>
      Array.from({ length: n }, (_, i) => card(stage, `${city} ${stage} ${i}`, FIRST_NEED[stage][i % FIRST_NEED[stage].length], city));
    const cards = [
      ...local("idea", 4, "Denver"),
      ...local("idea", 4, "Boulder"),
      ...local("idea", 4, "Colorado Springs"),
      ...local("launch", 5, "Denver"),
      ...local("launch", 5, "Fort Collins"),
      ...local("launch", 5, "Boulder"),
      ...local("launch", 5, "Loveland"),
    ];
    const [idea, launch] = topPicks(cards);
    const cityOf = (s: typeof idea) => s.picks.map((p) => p.card.city);
    expect(new Set(cityOf(idea)).size).toBe(3);
    expect(new Set(cityOf(launch)).size).toBe(3);
    // Fort Collins and Loveland were not used by Idea, so Launch reaches them first.
    expect(cityOf(launch)).toEqual(expect.arrayContaining(["Fort Collins", "Loveland"]));
    // Spread never costs a type: each stage still shows three types.
    expect(new Set(idea.picks.map((p) => p.card.type)).size).toBe(3);
  });

  it("does not count statewide or online as a city for spread", () => {
    const cards = [
      card("idea", "A Course", "education", "statewide"),
      card("idea", "B Network", "community", "statewide"),
      card("idea", "C Podcast", "media", "online"),
      card("idea", "D Meetup", "event", "online"),
    ];
    const [idea] = topPicks(cards);
    expect(idea.picks.map((p) => p.card.city)).toEqual(["statewide", "statewide", "online"]);
  });

  it("prefers the region's cities and nearby towns, keeping the spread rules", () => {
    const [idea, launch, growth, support] = topPicks(FIXTURE, { region: FUSION_CANYON });
    expect(idea.picks[0].card.name).toBe("Fort Collins Makers");
    expect(idea.picks[0].reason).toBe("your-region");
    const launchRegion = launch.picks.filter((p) => p.reason === "your-region").map((p) => p.card.name);
    expect(launchRegion).toEqual(["Loveland Launchpad", "Fort Collins Coworking"]);
    expect(new Set(launch.picks.map((p) => p.card.type)).size).toBe(3);
    // A stage with nothing in the region falls back to the statewide order.
    expect(growth.picks.map((p) => p.reason)).not.toContain("your-region");
    expect(growth.picks[0].reason).toBe("statewide");
    expect(support.picks[0].card.name).toBe("Fort Collins Innovation Hub");
    // A nearby town counts as the region.
    const nearby = topPicks([card("idea", "Greeley Founder School", "education", "Greeley, CO"), ...FIXTURE], { region: FUSION_CANYON });
    expect(nearby[0].picks.slice(0, 2).map((p) => [p.card.name, p.reason])).toEqual([
      ["Greeley Founder School", "your-region"],
      ["Fort Collins Makers", "your-region"],
    ]);
  });

  it("returns what a stage has when it has fewer than 3", () => {
    const cards = [
      card("idea", "Only Idea", "community", "Denver"),
      card("growth", "First Growth", "investor", "Boulder"),
      card("growth", "Second Growth", "media", "Denver"),
    ];
    const result = topPicks(cards);
    expect(result.map((s) => s.picks.length)).toEqual([1, 0, 2, 0]);
    expect(names(result)).toEqual([["Only Idea"], [], ["First Growth", "Second Growth"], []]);
  });

  it("returns four empty stages for an empty list", () => {
    expect(topPicks([])).toEqual(STAGES.map((stage) => ({ stage, picks: [] })));
  });

  it("ranks by stage, type, city and name only, so no url or description moves a card", () => {
    const promoted = FIXTURE.map((c) =>
      c.name === "Peak Angels"
        ? { ...c, url: "https://example.org/sponsored", description: "Sponsored. Featured partner. Top rated." }
        : c,
    );
    expect(names(topPicks(promoted))).toEqual(names(topPicks(FIXTURE)));
  });

  it("breaks ties by name", () => {
    const cards = [
      card("support", "Zeta Office", "government", "statewide"),
      card("support", "alpha Office", "government", "statewide"),
      card("support", "Beta Office", "government", "statewide"),
    ];
    expect(topPicks(cards)[3].picks.map((p) => p.card.name)).toEqual(["alpha Office", "Beta Office", "Zeta Office"]);
  });

  it("labels every pick with a known reason", () => {
    const reasons = new Set(["your-region", "statewide", "first-need", "spread"]);
    for (const s of topPicks(FIXTURE, { region: FUSION_CANYON })) {
      for (const p of s.picks) expect(reasons.has(p.reason)).toBe(true);
    }
    const spread = topPicks([card("support", "Some Group", "other", "Denver")])[3].picks[0];
    expect(spread.reason).toBe("spread");
    expect(LOCAL.has(spread.card.city)).toBe(false);
  });
});
