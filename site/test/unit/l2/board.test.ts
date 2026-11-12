import type { Company, Edition } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { buildBoard, countBy, foundingYears, latestEdition } from "../../../src/lib/leaderboard/board";
import { compareCells, nextDirection, sortedOrder } from "../../../src/lib/leaderboard/sort";

const company = (id: string, name: string, extra: Partial<Company> = {}): Company => ({
  id,
  name,
  website: `https://${id}.example`,
  hq_city: "Denver",
  sector: "Software",
  description: "Makes software.",
  sources: [`https://${id}.example/about`],
  ...extra,
});

const edition = (entries: Edition["entries"], published = "2026-10-08"): Edition => ({
  id: "test",
  title: "Test",
  kind: "honorees",
  published,
  summary: "",
  method: "",
  entries,
});

describe("buildBoard", () => {
  const cs = [company("zeta", "Zeta"), company("alpha", "alpha labs"), company("mid", "Mid")];

  it("returns one row per company, A to Z, ignoring case", () => {
    const rows = buildBoard(
      edition([
        { company: "zeta", group: "Overall" },
        { company: "alpha", group: "Startup" },
        { company: "mid", group: "Community Picks" },
      ]),
      cs,
    );
    expect(rows.map((r) => r.company.id)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("merges a company's groups in board order", () => {
    const rows = buildBoard(
      edition([
        { company: "zeta", group: "Community Picks" },
        { company: "zeta", group: "Overall" },
        { company: "zeta", group: "Startup" },
      ]),
      cs,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.groups).toEqual(["Overall", "Startup", "Community Picks"]);
  });

  it("fails loudly on an entry with no company file", () => {
    expect(() => buildBoard(edition([{ company: "ghost", group: "Overall" }]), cs)).toThrow(/ghost/);
  });
});

describe("countBy and foundingYears", () => {
  it("counts largest first, ties A to Z, and skips empty keys", () => {
    expect(countBy(["b", "a", "b", "", "c", "a"], (x) => x)).toEqual([
      { key: "a", count: 2 },
      { key: "b", count: 2 },
      { key: "c", count: 1 },
    ]);
  });

  it("counts founding years oldest first and leaves out unknown years", () => {
    const rows = buildBoard(
      edition([
        { company: "a", group: "Overall" },
        { company: "b", group: "Overall" },
        { company: "c", group: "Overall" },
      ]),
      [company("a", "A", { founded_year: 2021 }), company("b", "B", { founded_year: 2019 }), company("c", "C")],
    );
    expect(foundingYears(rows)).toEqual([
      { year: 2019, count: 1 },
      { year: 2021, count: 1 },
    ]);
  });

  it("picks the most recently published edition", () => {
    const older = { ...edition([{ company: "a", group: "Overall" }], "2026-01-01"), id: "old" };
    const newer = { ...edition([{ company: "a", group: "Overall" }], "2026-10-08"), id: "new" };
    expect(latestEdition([older, newer])?.id).toBe("new");
    expect(latestEdition([])).toBeUndefined();
  });
});

describe("table sort rules", () => {
  it("sorts text without regard to case, numbers numerically", () => {
    expect(sortedOrder(["beta", "Alpha", "gamma"], "text", "ascending")).toEqual([1, 0, 2]);
    expect(sortedOrder(["2019", "2008", "2021"], "number", "descending")).toEqual([2, 0, 1]);
  });

  it("keeps blanks last in both directions", () => {
    expect(sortedOrder(["2019", "", "2008"], "number", "ascending")).toEqual([2, 0, 1]);
    expect(sortedOrder(["2019", "", "2008"], "number", "descending")).toEqual([0, 2, 1]);
  });

  it("is stable for equal values", () => {
    expect(sortedOrder(["Denver", "Boulder", "Denver"], "text", "ascending")).toEqual([1, 0, 2]);
  });

  it("toggles direction and starts a new column ascending", () => {
    expect(nextDirection(null)).toBe("ascending");
    expect(nextDirection("ascending")).toBe("descending");
    expect(nextDirection("descending")).toBe("ascending");
    expect(compareCells("a", "a", "text", "ascending")).toBe(0);
  });
});
