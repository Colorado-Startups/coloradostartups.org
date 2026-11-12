// L22: a "largest sectors" or "most are in" summary keeps every entry tied with
// the last one it names. The 2026 Honorees have Consumer and retail and Space and
// aerospace at 10 each, and slice(0, 3) named only the first of the two.
import { describe, expect, it } from "vitest";

import { countBy, topWithTies } from "../../../src/lib/leaderboard/board";

const tally = (keys: string[]) => countBy(keys, (k) => k);
const names = (keys: string[], n: number) => topWithTies(tally(keys), n).map((c) => `${c.key} (${c.count})`);

describe("topWithTies", () => {
  it("self-test: slice(0, 3) drops one side of a tie at the cut-off", () => {
    const counts = tally(["a", "a", "a", "b", "b", "c", "d"]);
    expect(counts.slice(0, 3).map((c) => c.key)).toEqual(["a", "b", "c"]);
  });

  it("keeps every entry tied with the nth", () => {
    expect(names(["a", "a", "a", "b", "b", "c", "d"], 3)).toEqual(["a (3)", "b (2)", "c (1)", "d (1)"]);
  });

  it("stops at n when nothing past the nth ties with it", () => {
    expect(names(["a", "a", "a", "b", "b", "c", "c", "d"], 3)).toEqual(["a (3)", "b (2)", "c (2)"]);
  });

  it("returns everything when there are fewer than n entries", () => {
    expect(names(["a", "b"], 3)).toEqual(["a (1)", "b (1)"]);
    expect(names([], 3)).toEqual([]);
  });
});
