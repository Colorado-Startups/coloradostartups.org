// The startup credits calculator (step L4, 2026-11-15): a founder ticks their
// stage and the kinds of tools they use, and sees the programs that may fit and
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
//
// Some programs restate another company's credit: FounderPass and Secret
// list AWS credits, Stripe Atlas lists Cloudflare's, Ramp lists Google
// Cloud's and Mercury lists Supabase's. The total counts each credit once,
// by whose credit it is (creditOf), not by who lists it (review of PR #81).
import type { Cover, Program } from "../../lib/guides/credits";

export type Bucket = Program["bucket"];

/** One program, as the calculator needs it. */
export interface CalcProgram {
  id: string;
  /** The provider as a sentence names it ("Google"). */
  provider: string;
  /** Whose credit it is ("aws", "cloudflare"): the total takes one credit per key. See creditOf. */
  creditOf: string;
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
  /** The programs that may fit, largest stated amount first, then those with none. */
  programs: CalcProgram[];
  /**
   * The sum, over credit sources, of the largest amount any fitting program
   * states for that source. One credit per source, because a provider's tiers
   * replace each other, and a partner's listing restates the provider's own
   * credit rather than adding to it. Always shown as "up to".
   */
  upTo: number;
  /** How many credit sources that sum counts. */
  sources: number;
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
 * Programs whose stated amount is another company's credit, or a product
 * credit apart from its provider's cloud credit, by program id. Each was set
 * by reading the program's name, provider and amount note on the page
 * (data/credits/startup-programs.json, every row, 2026-11-15).
 */
export const CREDIT_OF: Readonly<Record<string, string>> = {
  // "AWS Activate Credits for Mercury customers."
  "aws-activate-mercury": "aws",
  // "$25,000 to $100,000 in AWS credits, set by an unnamed partner."
  "founderpass-aws": "aws",
  // "Up to $100,000 in AWS credits ... through an unnamed AWS partner."
  "secret-aws": "aws",
  // Its largest stated figure is "$100,000 of Cloudflare product credits".
  "stripe-atlas": "cloudflare",
  // "$350 in Google Cloud credits at sign-up."
  "ramp-perks": "google",
  // "$300 in Supabase credits over one year."
  "mercury-perks": "supabase",
  // Kiro seats, not AWS cloud credits; the provider reads "Amazon Web Services (Kiro)".
  "kiro-startup": "kiro",
};

/** The key of whose credit a program states: CREDIT_OF, else its provider's short name as a slug. */
export function creditOf(id: string, provider: string): string {
  return CREDIT_OF[id] ?? slug(provider);
}

const PROVIDER_KEYS: Readonly<Record<string, string>> = { "amazon web services": "aws" };
function slug(provider: string): string {
  const low = provider.toLowerCase().trim();
  return PROVIDER_KEYS[low] ?? low.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

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

/** The programs that may fit and the "up to" total. */
export function calculate(programs: readonly CalcProgram[], sel: Selection): CalcResult {
  const fit = programs.filter((p) => fits(p, sel));
  const best = new Map<string, number>();
  for (const p of fit) {
    if (p.amount === null) continue;
    best.set(p.creditOf, Math.max(best.get(p.creditOf) ?? 0, p.amount));
  }
  let upTo = 0;
  for (const n of best.values()) upTo += n;
  const sorted = [...fit].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  return {
    programs: sorted,
    upTo,
    sources: best.size,
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
  if (sel.covers.length === 0) return "Tick at least one kind of tool to see the programs that may fit.";
  if (r.programs.length === 0) return "No program on this page may fit those choices. Try ticking another kind of tool.";
  const fit = `${plural(r.programs.length, "program may fit", "programs may fit")}.`;
  const total =
    r.sources > 0
      ? ` Up to ${usd(r.upTo)} in credits, after each program's requirements, computed here from the largest amount stated for each of ${plural(r.sources, "credit source", "credit sources")}, per each program's own page, checked by ${checked}.`
      : "";
  const none =
    r.unstated > 0 ? ` ${plural(r.unstated, "program states", "programs state")} no dollar amount, so the total leaves ${r.unstated === 1 ? "it" : "them"} out.` : "";
  return `${fit}${total}${none}`;
}
