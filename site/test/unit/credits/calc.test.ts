// Step L4 (2026-11-15): components/credits/calc.ts, the startup credits
// calculator's pure logic. Fixtures only: filtering by stage and tool kind,
// the "up to" total, pass-through credits, programs with no stated amount,
// and an empty selection. The pass-through checks also run on the dated
// snapshot in data/credits/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  calculate,
  CREDIT_OF,
  creditOf,
  eligibleBuckets,
  fits,
  summary,
  type CalcProgram,
  type Selection,
} from "../../../src/components/credits/calc";
import { parseCredits, shortProvider, shownPrograms } from "../../../src/lib/guides/credits";
import { statedMax } from "../../../src/lib/guides/credits-chart";

const P = (over: Partial<CalcProgram> & Pick<CalcProgram, "id">): CalcProgram => {
  const provider = over.provider ?? "Acme";
  return {
    provider,
    creditOf: provider.toLowerCase(),
    bucket: "no_incorporation",
    covers: ["cpu"],
    amount: 100,
    ...over,
  };
};

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
    expect(r.sources).toBe(3);
  });
  it("sorts the largest stated amount first", () => {
    const amounts = calculate(PROGRAMS, sel({ funded: true })).programs.map((p) => p.amount);
    expect(amounts).toEqual([200_000, 2_000, 1_000, 300, 5, null]);
  });
  it("says may fit and up to, after each program's requirements, and names its arithmetic and the check date", () => {
    const s = sel({ company: true });
    const text = summary(calculate(PROGRAMS, s), s, "November 15, 2026");
    expect(text).toMatch(/^5 programs may fit\./);
    expect(text).toContain("Up to $3,005 in credits, after each program's requirements, computed here");
    expect(text).toContain("checked by November 15, 2026");
    expect(text).not.toMatch(/\b(get|claim|will receive|guaranteed)\b/i);
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
    expect(r).toMatchObject({ upTo: 0, sources: 0, unstated: 1 });
    expect(summary(r, s, "today")).not.toContain("$");
  });
});

describe("an empty selection", () => {
  it("with no tool kind ticked, matches nothing and asks for a tick", () => {
    const s = sel({ covers: [] });
    const r = calculate(PROGRAMS, s);
    expect(r).toEqual({ programs: [], upTo: 0, sources: 0, unstated: 0 });
    expect(summary(r, s, "today")).toBe("Tick at least one kind of tool to see the programs that may fit.");
  });
  it("with nothing fitting, says what to try", () => {
    const s = sel({ covers: ["gpu"] });
    expect(summary(calculate(PROGRAMS, s), s, "today")).toMatch(/^No program on this page may fit/);
  });
});

describe("pass-through credits", () => {
  // A partner restating AWS's credit, a bank restating Supabase's.
  const AWS = P({ id: "aws-portfolio", provider: "Amazon Web Services", creditOf: "aws", bucket: "funded_or_partner", amount: 200_000 });
  const RESOLD = P({ id: "resold-aws", provider: "Secret", creditOf: "aws", bucket: "incorporated", amount: 100_000 });
  const BANK = P({ id: "bank-perks", provider: "Mercury", creditOf: "supabase", bucket: "incorporated", amount: 300 });

  it("count the credit once, under whose credit it is, not who lists it", () => {
    const r = calculate([AWS, RESOLD, BANK], sel({ funded: true }));
    expect(r.upTo).toBe(200_300);
    expect(r.sources).toBe(2);
  });
  it("still stand in for the owner's credit when the owner's own program does not fit", () => {
    const r = calculate([AWS, RESOLD], sel({ company: true }));
    expect(r.upTo).toBe(100_000);
  });
  it("key by the override first, then by the provider", () => {
    expect(creditOf("secret-aws", "Secret")).toBe("aws");
    expect(creditOf("aws-activate", "Amazon Web Services")).toBe("aws");
    expect(creditOf("tenki", "Tenki")).toBe("tenki");
    expect(creditOf("x", "Together AI")).toBe("together-ai");
  });
});

describe("pass-through credits in the dated snapshot", () => {
  const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/credits/startup-programs.json");
  const shown = shownPrograms(parseCredits(readFileSync(FILE, "utf8")));
  // Built the way Calculator.astro builds them.
  const real: CalcProgram[] = shown.map((p) => ({
    id: p.id,
    provider: shortProvider(p.provider),
    creditOf: creditOf(p.id, shortProvider(p.provider)),
    bucket: p.bucket,
    covers: p.covers,
    amount: statedMax(p),
  }));
  const key = (id: string) => real.find((p) => p.id === id)?.creditOf;

  it("every override names a program the page shows", () => {
    for (const id of Object.keys(CREDIT_OF)) expect(key(id), id).toBeDefined();
  });
  it("keys FounderPass, Secret and Mercury's AWS offer to AWS, Stripe to Cloudflare, Ramp to Google, Mercury to Supabase", () => {
    expect(["founderpass-aws", "secret-aws", "aws-activate-mercury"].map(key)).toEqual(["aws", "aws", "aws"]);
    expect(key("stripe-atlas")).toBe("cloudflare");
    expect(key("ramp-perks")).toBe("google");
    expect(key("mercury-perks")).toBe("supabase");
    expect(["aws-activate", "aws-activate-portfolio", "new-aws-ai-startups"].map(key)).toEqual(["aws", "aws", "aws"]);
  });
  it("a row whose note names AWS credits counts as AWS, unless its largest figure is another company's", () => {
    for (const p of shown) {
      if (!/\bAWS (Activate )?credits\b/i.test(p.amount_note) || p.id === "stripe-atlas") continue;
      expect(key(p.id), p.id).toBe("aws");
    }
  });
  it("the pass-through listings add nothing past their owners' own credits for a funded founder", () => {
    const s = sel({ funded: true });
    const passThrough = new Set(["founderpass-aws", "secret-aws", "aws-activate-mercury", "stripe-atlas", "ramp-perks"]);
    const all = calculate(real, s);
    const without = calculate(
      real.filter((p) => !passThrough.has(p.id)),
      s,
    );
    expect(all.upTo).toBe(without.upTo);
    // Counted by listing provider instead, the five would add their own amounts.
    const byLister = new Map<string, number>();
    for (const p of all.programs) if (p.amount !== null) byLister.set(p.provider, Math.max(byLister.get(p.provider) ?? 0, p.amount));
    const overstated = [...byLister.values()].reduce((a, b) => a + b, 0) - all.upTo;
    expect(overstated).toBeGreaterThanOrEqual(100_000);
  });
});
