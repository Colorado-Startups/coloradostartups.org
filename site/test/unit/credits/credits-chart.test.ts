// Step F (2026-11-15): lib/guides/credits-chart.ts, the startup credits
// guide's bar chart of the largest credit each provider states. On fixtures
// and on the dated snapshot in data/credits/. The built page is checked in
// test/dom/credits/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseCredits, shortProvider, shownPrograms, type Program } from "../../../src/lib/guides/credits";
import {
  CHART_FLOOR,
  compact,
  creditBars,
  creditBarsNarrow,
  creditValue,
  providerCredits,
  statedMax,
} from "../../../src/lib/guides/credits-chart";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/credits/startup-programs.json");
const shown = shownPrograms(parseCredits(readFileSync(FILE, "utf8")));
const TEXT = { label: "The largest credit each provider states", description: "A test description." };

const program = (over: Partial<Program> & Pick<Program, "id">): Program =>
  ({
    program: over.id,
    provider: "Acme Cloud",
    bucket: "incorporated",
    credit_first: null,
    credit_max: null,
    credit_first_computed: false,
    credit_max_computed: false,
    amount_note: "A note.",
    covers: ["cpu"],
    requirements: ["A company."],
    term: null,
    traps: { card_required: null, expiry: null, overage: "unknown", trains_on_data: null, other: [] },
    link: "https://example.org/",
    source: "https://example.org/",
    checked: "2026-11-02",
    ...over,
  }) as Program;

describe("statedMax", () => {
  it("takes the larger stated amount and never a computed one", () => {
    expect(statedMax(program({ id: "a", credit_first: 1000, credit_max: 5000 }))).toBe(5000);
    expect(statedMax(program({ id: "b", credit_first: 1000, credit_max: 9000, credit_max_computed: true }))).toBe(1000);
    expect(statedMax(program({ id: "c", credit_max: 9000, credit_max_computed: true }))).toBeNull();
    expect(statedMax(program({ id: "d" }))).toBeNull();
  });
});

describe("providerCredits", () => {
  it("keeps each provider's largest stated credit, largest first, then A to Z", () => {
    const rows = providerCredits([
      program({ id: "a1", provider: "Acme Cloud", credit_max: 300 }),
      program({ id: "a2", provider: "Acme Cloud", credit_max: 2000, bucket: "funded_or_partner" }),
      program({ id: "b1", provider: "Beta AI (Beta, Inc.)", credit_max: 2000 }),
      program({ id: "c1", provider: "Cobalt", amount_note: "EUR 9,000" }),
    ]);
    expect(rows.map((r) => [r.provider, r.amount, r.program.id, r.needsRound])).toEqual([
      ["Acme Cloud", 2000, "a2", true],
      ["Beta AI", 2000, "b1", false],
    ]);
  });

  it("lets the program a founder can claim sooner stand for a tie", () => {
    const rows = providerCredits([
      program({ id: "late", credit_max: 5000, bucket: "funded_or_partner" }),
      program({ id: "soon", credit_max: 5000, bucket: "no_incorporation" }),
    ]);
    expect(rows.map((r) => [r.program.id, r.needsRound])).toEqual([["soon", false]]);
  });

  it("on the snapshot, names each provider once and charts only stated amounts", () => {
    const rows = providerCredits(shown);
    expect(new Set(rows.map((r) => r.provider)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.provider).toBe(shortProvider(r.program.provider));
      expect([r.program.credit_first_computed ? null : r.program.credit_first, r.program.credit_max_computed ? null : r.program.credit_max]).toContain(r.amount);
    }
    expect(rows.filter((r) => r.amount >= CHART_FLOOR).length).toBeGreaterThan(5);
  });
});

describe("labels", () => {
  it("writes amounts compactly, with no currency sign", () => {
    expect([compact(500_000), compact(5_500), compact(10_000), compact(350), compact(1_200_000)]).toEqual([
      "500K",
      "5.5K",
      "10K",
      "350",
      "1.2M",
    ]);
  });

  it("names the program that states each amount, as its source", () => {
    const [row] = providerCredits([program({ id: "x", program: "Acme Boost", credit_max: 25000, bucket: "funded_or_partner" })]);
    expect(creditValue(row!)).toBe("$25,000, per Acme Boost (needs a round or a partner code)");
  });
});

describe("the charts", () => {
  const rows = providerCredits(shown).filter((r) => r.amount >= CHART_FLOOR);

  it.each([
    ["wide", creditBars],
    ["phone", creditBarsNarrow],
  ] as const)("draws the %s chart as one labeled image, a bar and a hover title per provider", (_name, draw) => {
    const svg = draw(rows, TEXT);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain(`aria-label="${TEXT.label}"`);
    const titles = [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    expect(titles).toHaveLength(rows.length);
    for (const r of rows) expect(titles.some((t) => t!.startsWith(`${r.provider.replace(/&/g, "&amp;")}: $`))).toBe(true);
    // No currency sign in the drawn labels: the caption and axis carry the unit.
    const labels = svg.replace(/<title>[^<]*<\/title>/g, "").match(/>[^<]*\$[^<]*</g) ?? [];
    expect(labels).toEqual([]);
  });
});
