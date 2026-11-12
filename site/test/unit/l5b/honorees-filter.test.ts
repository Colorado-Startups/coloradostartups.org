import { describe, expect, it } from "vitest";

import { honoreeCount, matchesHonoree, optionsFrom } from "../../../src/components/leaderboard/honorees-filter";

// L5b: the Leaderboard's honorees filter (#145).

const row = {
  name: "Ibotta",
  description: "Performance marketing platform for consumer packaged goods brands.",
  sector: "Software",
  city: "Denver",
};

describe("matchesHonoree", () => {
  it("shows every row when no filter is set", () => {
    expect(matchesHonoree(row, {})).toBe(true);
    expect(matchesHonoree(row, { q: "  ", sector: "", city: "" })).toBe(true);
  });

  it("matches sector and city exactly", () => {
    expect(matchesHonoree(row, { sector: "Software", city: "Denver" })).toBe(true);
    expect(matchesHonoree(row, { sector: "Software", city: "Boulder" })).toBe(false);
    expect(matchesHonoree(row, { sector: "Soft" })).toBe(false);
  });

  it("needs every search word in the name or description, whatever the case or accents", () => {
    expect(matchesHonoree(row, { q: "ibotta" })).toBe(true);
    expect(matchesHonoree(row, { q: "MARKETING brands" })).toBe(true);
    expect(matchesHonoree(row, { q: "marketing hardware" })).toBe(false);
    expect(matchesHonoree({ ...row, name: "Café Labs" }, { q: "cafe" })).toBe(true);
  });

  it("combines the search with the selects", () => {
    expect(matchesHonoree(row, { q: "marketing", city: "Denver" })).toBe(true);
    expect(matchesHonoree(row, { q: "marketing", city: "Golden" })).toBe(false);
  });
});

describe("honoreeCount", () => {
  it("says how many rows show, and what to do when none does", () => {
    expect(honoreeCount(115, 115)).toBe("Showing all 115 companies.");
    expect(honoreeCount(12, 115)).toBe("Showing 12 of 115 companies.");
    expect(honoreeCount(0, 115)).toBe("No company fits these filters. Clear one to see more.");
  });
});

describe("optionsFrom", () => {
  it("lists each value once, A to Z, ignoring case", () => {
    expect(optionsFrom(["Denver", "boulder", "Denver", "Aurora"])).toEqual(["Aurora", "boulder", "Denver"]);
  });
});
