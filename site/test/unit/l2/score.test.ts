import { describe, expect, it } from "vitest";

import {
  type GrowthInput,
  type GrowthScore,
  GrowthScoreNotWrittenError,
  growthScore,
  rankNominees,
} from "../../../src/lib/leaderboard/score";

const nominee = (legal_name: string, base: number, current: number, fte = 10): GrowthInput => ({
  legal_name,
  base_year: 2022,
  base_year_revenue_usd: base,
  current_year_revenue_usd: current,
  fte_headcount: fte,
});

// A stand-in scorer with fixed, simple rules, so the ranking mechanics are
// tested independently of the choices Paul makes in growthScore().
const fakeScorer = (n: GrowthInput): GrowthScore | null => {
  if (n.base_year_revenue_usd < 100) return null;
  const growthPct = ((n.current_year_revenue_usd - n.base_year_revenue_usd) / n.base_year_revenue_usd) * 100;
  return {
    tier: n.current_year_revenue_usd >= 10_000 ? "growth" : "startup",
    growthPct,
    tieBreak: n.current_year_revenue_usd,
  };
};

describe("rankNominees (contract, independent of growthScore)", () => {
  it("orders by growth, high to low, and numbers ranks from 1 within each tier", () => {
    const r = rankNominees([nominee("Slow", 100, 150), nominee("Fast", 100, 900), nominee("Mid", 100, 300)], fakeScorer);
    expect(r.startup.map((e) => e.nominee.legal_name)).toEqual(["Fast", "Mid", "Slow"]);
    expect(r.startup.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("keeps tiers apart, each with its own rank 1", () => {
    const r = rankNominees([nominee("Small", 1_000, 5_000), nominee("Big", 10_000, 20_000)], fakeScorer);
    expect(r.startup.map((e) => [e.nominee.legal_name, e.rank])).toEqual([["Small", 1]]);
    expect(r.growth.map((e) => [e.nominee.legal_name, e.rank])).toEqual([["Big", 1]]);
  });

  it("leaves out nominees the scorer marks ineligible", () => {
    const r = rankNominees([nominee("Tiny", 50, 5_000), nominee("Real", 1_000, 2_000)], fakeScorer);
    expect([...r.startup, ...r.growth].map((e) => e.nominee.legal_name)).toEqual(["Real"]);
  });

  it("breaks a growth tie with tieBreak, high to low", () => {
    // Both doubled; B ends with more revenue, and the fake tie-break is current revenue.
    const r = rankNominees([nominee("A", 1_000, 2_000), nominee("B", 2_000, 4_000)], fakeScorer);
    expect(r.startup.map((e) => e.nominee.legal_name)).toEqual(["B", "A"]);
  });

  it("falls back to legal name A to Z when growth and tieBreak both tie", () => {
    const r = rankNominees([nominee("Zeta", 1_000, 2_000), nominee("Alpha", 1_000, 2_000)], fakeScorer);
    expect(r.startup.map((e) => [e.nominee.legal_name, e.rank])).toEqual([
      ["Alpha", 1],
      ["Zeta", 2],
    ]);
  });

  it("gives the same order whatever order the nominees arrive in", () => {
    const list = [nominee("C", 100, 300), nominee("A", 100, 300), nominee("B", 100, 900)];
    const forward = rankNominees(list, fakeScorer).startup.map((e) => e.nominee.legal_name);
    const backward = rankNominees([...list].reverse(), fakeScorer).startup.map((e) => e.nominee.legal_name);
    expect(forward).toEqual(["B", "A", "C"]);
    expect(backward).toEqual(forward);
  });

  it("drops a score that is not a finite number instead of sorting it", () => {
    const r = rankNominees([nominee("Broken", 0, 100)], () => ({ tier: "startup", growthPct: Infinity, tieBreak: 0 }));
    expect(r.startup).toEqual([]);
  });

  it("does not modify the input array", () => {
    const list = [nominee("B", 100, 200), nominee("A", 100, 900)];
    rankNominees(list, fakeScorer);
    expect(list.map((n) => n.legal_name)).toEqual(["B", "A"]);
  });
});

// growthScore() is Paul's to write. Until then it throws, and these tests are
// skipped rather than failing the suite. They switch on by themselves once the
// body stops throwing.
const written = (() => {
  try {
    growthScore(nominee("Probe", 1_000_000, 2_000_000));
    return true;
  } catch (err) {
    return !(err instanceof GrowthScoreNotWrittenError);
  }
})();

describe("growthScore placeholder", () => {
  it.skipIf(written)("throws a named error until Paul writes it", () => {
    expect(() => growthScore(nominee("X", 1, 2))).toThrow(GrowthScoreNotWrittenError);
  });
});

describe.skipIf(!written)("growthScore (invariants any choice must keep)", () => {
  it("returns null for a zero base instead of dividing by zero", () => {
    expect(growthScore(nominee("Zero", 0, 5_000_000))).toBeNull();
  });

  it("returns finite numbers and a known tier for an eligible company", () => {
    const s = growthScore(nominee("Solid", 2_000_000, 6_000_000));
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!.growthPct)).toBe(true);
    expect(Number.isFinite(s!.tieBreak)).toBe(true);
    expect(["startup", "growth"]).toContain(s!.tier);
  });

  it("scores more growth higher for two companies of the same size", () => {
    const fast = growthScore(nominee("Fast", 2_000_000, 8_000_000))!;
    const slow = growthScore(nominee("Slow", 2_000_000, 3_000_000))!;
    expect(fast.growthPct).toBeGreaterThan(slow.growthPct);
  });

  it("scores a shrinking company below a flat one", () => {
    const flat = growthScore(nominee("Flat", 2_000_000, 2_000_000));
    const shrink = growthScore(nominee("Shrink", 2_000_000, 1_000_000));
    if (flat && shrink) expect(shrink.growthPct).toBeLessThan(flat.growthPct);
  });

  it("does not depend on the company's name", () => {
    expect(growthScore(nominee("A", 2_000_000, 5_000_000))).toEqual(growthScore(nominee("B", 2_000_000, 5_000_000)));
  });

  // Paul's four choices (minimum base, tier line, published growth figure,
  // tie-break) wait on the formula body; issue #574 lists them as cases.
});
