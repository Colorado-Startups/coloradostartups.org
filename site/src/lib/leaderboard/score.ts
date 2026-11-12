// Scoring for verified Leaderboard editions. Honoree editions are unranked and
// never call this file.
//
// Split on purpose:
//   - growthScore() holds every judgment call: the growth measure, the minimum
//     base, the tier boundary and the tie-break. Paul writes its body.
//   - rankNominees() is mechanics: drop the ineligible, split by tier, sort,
//     number. It is written and tested now against an injected scorer, so it
//     does not wait on growthScore().

import type { Nomination } from "@cs/shared";

type Tier = "startup" | "growth";

/** The slice of a nomination that scoring may read. Nothing else is in scope. */
export type GrowthInput = Pick<
  Nomination,
  "legal_name" | "base_year" | "base_year_revenue_usd" | "current_year_revenue_usd" | "fte_headcount"
>;

export interface GrowthScore {
  /** Which list the company competes on. */
  tier: Tier;
  /** The growth measure. Higher ranks first. Shown publicly as growth_pct. */
  growthPct: number;
  /** Breaks a tie in growthPct. Higher ranks first. Never shown publicly. */
  tieBreak: number;
}

export class GrowthScoreNotWrittenError extends Error {
  constructor() {
    super("growthScore() is waiting for Paul's choices (Project 2 card \"growthScore: Paul's four choices the test file lists\")");
    this.name = "GrowthScoreNotWrittenError";
  }
}

/**
 * Score one verified nomination, or return null when it is not eligible.
 *
 * The decisions this body makes, and their trade-offs:
 *
 * 1. Growth measure. Total growth over the window,
 *    (current - base) / base * 100, is what the Inc. 5000 publishes and is
 *    easy to explain. Annualized growth (CAGR) treats a 3-year and a 2-year
 *    window fairly but reads less plainly. The method copy on /leaderboard/
 *    promises "3-year growth", so a fixed window keeps the two in step.
 *
 * 2. Minimum base. Percent growth from a tiny base is noise: $10k to $1M is
 *    9,900%. A floor on base_year_revenue_usd keeps the list about companies
 *    with real revenue. Higher floors exclude more young companies. Return null
 *    below the floor; a zero base must also return null (division by zero).
 *
 * 3. Tiers. "startup" and "growth" let a young company compete with its peers
 *    instead of with a company ten times its size. The boundary can be a
 *    revenue line (on current or base revenue) or a headcount line. Revenue is
 *    harder to inflate; headcount is easier to verify from public sources.
 *
 * 4. Tie-break. Two equal growthPct values need a second key. Options: current
 *    revenue (rewards scale), absolute dollar growth (rewards scale and
 *    momentum), or headcount growth if it is ever collected. rankNominees()
 *    falls back to legal_name A to Z only after this.
 *
 * Also decide: does the window require exactly 3 years
 * (current year = base_year + 3)? The form collects base_year only, so the
 * edition's own year sets "current".
 */
export function growthScore(_n: GrowthInput): GrowthScore | null {
  // Paul's four choices, on the Project 2 card "growthScore: Paul's four
  // choices the test file lists": 5 to 10 lines. Return null when ineligible
  // (below your minimum base, or a zero base); otherwise return { tier,
  // growthPct, tieBreak }. The tests in site/test/unit/l2/score.test.ts switch
  // on once this stops throwing; the cases marked for Paul there record them.
  throw new GrowthScoreNotWrittenError();
}

interface RankedNominee<T extends GrowthInput> {
  nominee: T;
  score: GrowthScore;
  /** 1-based position within the tier. */
  rank: number;
}

export type Ranking<T extends GrowthInput> = Record<Tier, RankedNominee<T>[]>;

/**
 * Rank nominees within each tier: growthPct high to low, then tieBreak high to
 * low, then legal_name A to Z so the order is total and repeatable. Companies
 * the scorer marks ineligible (null) are left out. Equal scores still get
 * distinct ranks; the name order is an ordering, not a shared place.
 */
export function rankNominees<T extends GrowthInput>(
  nominees: readonly T[],
  scorer: (n: GrowthInput) => GrowthScore | null = growthScore,
): Ranking<T> {
  const ranking: Ranking<T> = { startup: [], growth: [] };
  for (const nominee of nominees) {
    const score = scorer(nominee);
    if (score && Number.isFinite(score.growthPct) && Number.isFinite(score.tieBreak)) {
      ranking[score.tier].push({ nominee, score, rank: 0 });
    }
  }
  for (const tier of Object.keys(ranking) as Tier[]) {
    ranking[tier].sort(
      (a, b) =>
        b.score.growthPct - a.score.growthPct ||
        b.score.tieBreak - a.score.tieBreak ||
        a.nominee.legal_name.localeCompare(b.nominee.legal_name, "en"),
    );
    ranking[tier].forEach((entry, i) => (entry.rank = i + 1));
  }
  return ranking;
}
