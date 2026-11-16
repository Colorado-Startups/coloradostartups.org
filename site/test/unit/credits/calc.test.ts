// Step L4 (2026-11-15): components/credits/calc.ts, the startup credits
// calculator's pure logic. Fixtures only: filtering by stage and tool kind,
// the "up to" total, programs with no stated amount, and an empty selection.
import { describe, expect, it } from "vitest";

import {
  calculate,
  eligibleBuckets,
  fits,
  summary,
  type CalcProgram,
  type Selection,
} from "../../../src/components/credits/calc";

const P = (over: Partial<CalcProgram> & Pick<CalcProgram, "id">): CalcProgram => ({
  provider: "Acme",
  bucket: "no_incorporation",
  covers: ["cpu"],
  amount: 100,
  ...over,
});

const PROGRAMS: CalcProgram[] = [
  P({ id: "acme-trial", provider: "Acme", bucket: "no_incorporation", covers: ["cpu", "other"], amount: 300 }),
  P({ id: "acme-start", provider: "Acme", bucket: "incorporated", covers: ["cpu", "gpu"], amount: 2_000 }),
  P({ id: "acme-scale", provider: "Acme", bucket: "funded_or_partner", covers: ["cpu", "gpu"], amount: 200_000 }),
  P({ id: "bolt-gpu", provider: "Bolt", bucket: "incorporated", covers: ["gpu"], amount: 1_000 }),
  P({ id: "chat-api", provider: "Chat", bucket: "no_incorporation", covers: ["inference"], amount: 5 }),
  P({ id: "dev-tools", provider: "Dev", bucket: "incorporated", covers: ["other"], amount: null }),
];

const ALL = ["cpu", "gpu", "inference", "other"] as const;
const sel = (over: Partial<Selection> = {}): Selection => ({ company: false, funded: false, covers: ALL, ...over });
const ids = (s: Selection) => calculate(PROGRAMS, s).programs.map((p) => p.id);

describe("eligibleBuckets", () => {
  it("opens the first group to anyone", () => {
    expect([...eligibleBuckets({ company: false, funded: false })]).toEqual(["no_incorporation"]);
  });
  it("adds the company group for a company", () => {
    expect([...eligibleBuckets({ company: true, funded: false })]).toEqual(["no_incorporation", "incorporated"]);
  });
  it("counts a round or partner code as a company too", () => {
    expect([...eligibleBuckets({ company: false, funded: true })]).toEqual([
      "no_incorporation",
      "incorporated",
      "funded_or_partner",
    ]);
  });
});

describe("filtering", () => {
  it("by stage", () => {
    expect(ids(sel())).toEqual(["acme-trial", "chat-api"]);
    expect(ids(sel({ company: true }))).toEqual(["acme-start", "bolt-gpu", "acme-trial", "chat-api", "dev-tools"]);
    expect(ids(sel({ funded: true }))).toContain("acme-scale");
  });
  it("by tool kind: a program fits when it covers any ticked kind", () => {
    expect(ids(sel({ company: true, covers: ["gpu"] }))).toEqual(["acme-start", "bolt-gpu"]);
    expect(ids(sel({ company: true, covers: ["inference", "other"] }))).toEqual(["acme-trial", "chat-api", "dev-tools"]);
    expect(fits(PROGRAMS[0]!, sel({ covers: ["gpu"] }))).toBe(false);
  });
});

describe("the up to total", () => {
  it("takes the largest stated amount once per provider, because tiers replace each other", () => {
    const r = calculate(PROGRAMS, sel({ funded: true }));
    // Acme 200,000 (its scale tier, not 300 + 2,000 + 200,000), Bolt 1,000, Chat 5.
    expect(r.upTo).toBe(201_005);
    expect(r.providers).toBe(3);
  });
  it("sorts the largest stated amount first", () => {
    const amounts = calculate(PROGRAMS, sel({ funded: true })).programs.map((p) => p.amount);
    expect(amounts).toEqual([200_000, 2_000, 1_000, 300, 5, null]);
  });
  it("says up to, names its arithmetic and the check date", () => {
    const s = sel({ company: true });
    const text = summary(calculate(PROGRAMS, s), s, "November 15, 2026");
    expect(text).toContain("Up to $3,005 in credits, computed here");
    expect(text).toContain("checked by November 15, 2026");
  });
});

describe("programs with no stated amount", () => {
  it("still fit, sort last and stay out of the total", () => {
    const s = sel({ company: true, covers: ["other"] });
    const r = calculate(PROGRAMS, s);
    expect(r.programs.map((p) => p.id)).toEqual(["acme-trial", "dev-tools"]);
    expect(r.upTo).toBe(300);
    expect(r.unstated).toBe(1);
    expect(summary(r, s, "today")).toContain("1 program states no dollar amount, so the total leaves it out.");
  });
  it("leave no total when none states an amount", () => {
    const s = sel({ company: true, covers: ["other"] });
    const r = calculate([PROGRAMS[5]!], s);
    expect(r).toMatchObject({ upTo: 0, providers: 0, unstated: 1 });
    expect(summary(r, s, "today")).not.toContain("$");
  });
});

describe("an empty selection", () => {
  it("with no tool kind ticked, matches nothing and asks for a tick", () => {
    const s = sel({ covers: [] });
    const r = calculate(PROGRAMS, s);
    expect(r).toEqual({ programs: [], upTo: 0, providers: 0, unstated: 0 });
    expect(summary(r, s, "today")).toBe("Tick at least one kind of tool to see the programs that fit.");
  });
  it("with nothing fitting, says what to try", () => {
    const s = sel({ covers: ["gpu"] });
    expect(summary(calculate(PROGRAMS, s), s, "today")).toMatch(/^No program on this page fits/);
  });
});
