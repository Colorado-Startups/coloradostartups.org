// The startup credits guide's chart (step F of the redesign, 2026-11-15): the
// largest credit each provider's own page states, one bar per provider,
// largest first. Rendered to SVG at build time through lib/plot.ts, with a
// phone version, for ChartFigure. No client JavaScript.
//
// Only amounts a provider states count, never a total computed here (the
// amountLine rule in credits.ts, review of PR #103). A program with no dollar
// figure (a discount, a spend match, an amount in EUR) has no bar; the tables
// list it.
//
// Color has one job: whether the bar's program needs a funding round or a
// partner code. Two steps of the site's ink: the text color, the strongest
// on the ground in either theme, for a credit you can claim without raising,
// and the border color for one that needs a round. The theme swaps which is
// darker, so no words call them dark or light. The
// dataviz validator (2026-11-15) reads the pair at ΔE 27.2 under the worst
// color-vision simulation in light mode and 35.4 in dark, both steps 3:1 or
// more on the surface; its lightness-band and chroma checks are for a palette
// of hues, which this is not. The legend beside the chart and the data table
// carry the same split in words.
import * as Plot from "@observablehq/plot";

import { renderPlot, type ChartText } from "../plot";
import { shortProvider, type Program } from "./credits";

export interface ProviderCredit {
  /** The provider as a sentence names it ("Amazon Web Services"). */
  provider: string;
  /** The largest amount the provider's page states, in US dollars. */
  amount: number;
  /** The program that states it. */
  program: Program;
  /** True when that program needs a funding round, a partner code or an invitation. */
  needsRound: boolean;
}

/** A program's largest stated amount, or null when its page states none in dollars. */
export function statedMax(p: Program): number | null {
  const stated = [
    p.credit_first_computed ? null : p.credit_first,
    p.credit_max_computed ? null : p.credit_max,
  ].filter((n): n is number => n !== null);
  return stated.length > 0 ? Math.max(...stated) : null;
}

/**
 * Each provider's largest stated credit, largest first, then A to Z. When two
 * of a provider's programs state the same amount, the one a founder can claim
 * sooner (the earlier group) stands for it.
 */
export function providerCredits(programs: readonly Program[]): ProviderCredit[] {
  const best = new Map<string, ProviderCredit>();
  for (const p of programs) {
    const amount = statedMax(p);
    if (amount === null) continue;
    const provider = shortProvider(p.provider);
    const needsRound = p.bucket === "funded_or_partner";
    const seen = best.get(provider);
    if (!seen || amount > seen.amount || (amount === seen.amount && seen.needsRound && !needsRound)) {
      best.set(provider, { provider, amount, program: p, needsRound });
    }
  }
  return [...best.values()].sort((a, b) => b.amount - a.amount || a.provider.localeCompare(b.provider, "en"));
}

/** The smallest amount the chart draws; the tables list the rest. */
export const CHART_FLOOR = 10_000;

/** "500K", "5.5K", "350": compact, with no currency sign (the axis says US dollars). */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The hover text and table value: the amount, with the program that states it as its source. */
export function creditValue(d: ProviderCredit): string {
  return `${usd(d.amount)}, per ${d.program.program}${d.needsRound ? " (needs a round or a partner code)" : ""}`;
}

export const NO_ROUND_FILL = "var(--c-text)";
export const ROUND_FILL = "var(--c-border)";
const LINE = "var(--c-rule)";

/** The bars, in two marks: a credit you can claim now, and one that needs a round. */
function bars(rows: readonly ProviderCredit[], options: Plot.BarXOptions): Plot.Markish[] {
  const title = (d: ProviderCredit) => `${d.provider}: ${creditValue(d)}`;
  return [
    Plot.barX(
      rows.filter((d) => !d.needsRound),
      { x: "amount", y: "provider", fill: NO_ROUND_FILL, rx2: 4, title, ...options },
    ),
    Plot.barX(
      rows.filter((d) => d.needsRound),
      { x: "amount", y: "provider", fill: ROUND_FILL, rx2: 4, title, ...options },
    ),
  ];
}

/** The credits chart: providers down the side, each bar its largest stated credit. */
export function creditBars(rows: readonly ProviderCredit[], text: ChartText): string {
  return renderPlot({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: 720,
    // The axis label sits under the tick numbers at a 48 marginBottom (#295,
    // as leaderboard/charts.ts found); each row is 26 units.
    height: 58 + rows.length * 26,
    marginLeft: 160,
    marginRight: 48,
    marginBottom: 48,
    x: { label: "Largest credit stated, US dollars", grid: true, ticks: 5, tickFormat: compact },
    y: { label: null, domain: rows.map((d) => d.provider), padding: 0.25 },
    marks: [
      ...bars(rows, {}),
      Plot.text(rows, {
        x: "amount",
        y: "provider",
        text: (d: ProviderCredit) => compact(d.amount),
        dx: 6,
        textAnchor: "start",
        fill: "currentColor",
      }),
      Plot.ruleX([0], { stroke: LINE }),
    ],
  });
}

// The phone version: 312 units wide and shown at its own size, so its text
// draws at 15 px on any screen 360 px or wider (leaderboard/charts.ts #329).
const NARROW_WIDTH = 312;

/** creditBars for phones: each name above its bar, the amount at the bar's end, no axis. */
export function creditBarsNarrow(rows: readonly ProviderCredit[], text: ChartText): string {
  const ROW = 40;
  return renderPlot({
    ariaLabel: text.label,
    ariaDescription: text.description,
    width: NARROW_WIDTH,
    height: 8 + rows.length * ROW,
    marginTop: 4,
    marginBottom: 4,
    marginLeft: 0,
    marginRight: 40,
    x: { axis: null },
    y: { axis: null, domain: rows.map((d) => d.provider), padding: 0 },
    marks: [
      // The name's line ends 4 units above the row's middle, and the bar
      // starts 2 below it, so the two never touch.
      ...bars(rows, { insetTop: ROW / 2 + 2, insetBottom: 6 }),
      Plot.text(rows, {
        x: 0,
        y: "provider",
        text: "provider",
        textAnchor: "start",
        lineAnchor: "bottom",
        dy: -4,
        fill: "currentColor",
      }),
      Plot.text(rows, {
        x: "amount",
        y: "provider",
        text: (d: ProviderCredit) => compact(d.amount),
        dx: 6,
        dy: 8,
        textAnchor: "start",
        fill: "currentColor",
      }),
      Plot.ruleX([0], { stroke: LINE }),
    ],
  });
}
