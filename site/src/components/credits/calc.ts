// The startup credits calculator (step L4, 2026-11-15): a founder ticks their
// stage and the kinds of tools they use, and sees the programs that fit and
// an "up to" total. Pure logic with no runtime imports, so the browser bundle
// stays tiny: credits.ts pulls in zod and credits-chart.ts pulls in Plot, and
// neither belongs in client JavaScript. Calculator.astro shapes each program
// at build time into a CalcProgram and writes it into data attributes; the
// script reads them back and calls these functions.
//
// Only fields already public on the page feed it (issue #11): the group, what
// a program covers, the provider and the amount its own page states. A total
// computed here never counts; the chart's statedMax rule (credits-chart.ts)
// is the one this follows.
import type { Cover, Program } from "../../lib/guides/credits";

export type Bucket = Program["bucket"];

/** One program, as the calculator needs it. */
export interface CalcProgram {
  id: string;
  /** The provider as a sentence names it ("Google Cloud"); totals take one credit per provider. */
  provider: string;
  bucket: Bucket;
  covers: readonly Cover[];
  /** The largest amount the provider's own page states, in US dollars, or null when it states none. */
  amount: number | null;
}

/** What the founder ticked. */
export interface Selection {
  /** "We formed a company." */
  company: boolean;
  /** "We raised a round, or an accelerator or investor gave us a partner code." */
  funded: boolean;
  /** The kinds of tools they use. None ticked matches nothing. */
  covers: readonly Cover[];
}

export interface CalcResult {
  /** The programs that fit, largest stated amount first, then those with none. */
  programs: CalcProgram[];
  /**
   * The sum, over providers, of the largest amount any fitting program of that
   * provider states. One credit per provider, because a provider's tiers
   * replace each other rather than stack. Always shown as "up to".
   */
  upTo: number;
  /** How many providers that sum counts. */
  providers: number;
  /** How many fitting programs state no dollar amount, so the sum leaves them out. */
  unstated: number;
}

/** What each kind of tool means, in a founder's words. The page's coverage chart uses it too. */
export const COVER_MEANS: Record<Cover, string> = {
  cpu: "servers for your site, app and database",
  gpu: "chips that train and run AI models",
  inference: "calls to a hosted AI model",
  other: "storage, databases and developer tools",
};

/**
 * The groups a founder can apply to. Anyone can claim the first; a company
 * opens the second; a round or partner code opens the third, and counts as a
 * company too, since those programs check for one.
 */
export function eligibleBuckets(sel: Pick<Selection, "company" | "funded">): Set<Bucket> {
  const out = new Set<Bucket>(["no_incorporation"]);
  if (sel.company || sel.funded) out.add("incorporated");
  if (sel.funded) out.add("funded_or_partner");
  return out;
}

/** True when the program is open to this stage and covers at least one ticked kind of tool. */
export function fits(p: CalcProgram, sel: Selection): boolean {
  return eligibleBuckets(sel).has(p.bucket) && p.covers.some((c) => sel.covers.includes(c));
}

/** The programs that fit and the "up to" total. */
export function calculate(programs: readonly CalcProgram[], sel: Selection): CalcResult {
  const fit = programs.filter((p) => fits(p, sel));
  const best = new Map<string, number>();
  for (const p of fit) {
    if (p.amount === null) continue;
    best.set(p.provider, Math.max(best.get(p.provider) ?? 0, p.amount));
  }
  let upTo = 0;
  for (const n of best.values()) upTo += n;
  const sorted = [...fit].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  return {
    programs: sorted,
    upTo,
    providers: best.size,
    unstated: fit.filter((p) => p.amount === null).length,
  };
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The result in one sentence for the live region. Every figure carries its
 * source in the same sentence ("computed here", "per each provider's page").
 */
export function summary(r: CalcResult, sel: Selection, checked: string): string {
  if (sel.covers.length === 0) return "Tick at least one kind of tool to see the programs that fit.";
  if (r.programs.length === 0) return "No program on this page fits those choices. Try ticking another kind of tool.";
  const fit = `${plural(r.programs.length, "program fits", "programs fit")}.`;
  const total =
    r.providers > 0
      ? ` Up to ${usd(r.upTo)} in credits, computed here from the largest amount each of ${plural(r.providers, "provider", "providers")} states on its own page, checked by ${checked}.`
      : "";
  const none =
    r.unstated > 0 ? ` ${plural(r.unstated, "program states", "programs state")} no dollar amount, so the total leaves ${r.unstated === 1 ? "it" : "them"} out.` : "";
  return `${fit}${total}${none}`;
}
