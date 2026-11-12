// Pure shaping of Leaderboard content for the page and the charts. No Astro
// imports, so it unit-tests in plain Node; the page passes in the collection
// data it loaded.

import type { Company, Edition } from "@cs/shared";

// The boards the 2026 Honorees came from, in display order. An edition entry's
// `group` must be one of these (test/unit/l2/data.test.ts).
export const HONOREE_GROUPS = ["Overall", "Startup", "Community Picks"] as const;

export interface BoardRow {
  company: Company;
  /** Every group this company appears in, in HONOREE_GROUPS order. */
  groups: string[];
}

const byName = (a: Company, b: Company) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * One row per company, A to Z by name. An edition lists a company once per
 * group it belongs to; the board shows it once with all of its groups. Entries
 * whose company file is missing throw, so a typo fails the build instead of
 * silently dropping an honoree.
 */
export function buildBoard(edition: Edition, companies: readonly Company[]): BoardRow[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const groupOrder = (g: string) => {
    const i = (HONOREE_GROUPS as readonly string[]).indexOf(g);
    return i === -1 ? HONOREE_GROUPS.length : i;
  };
  const rows = new Map<string, BoardRow>();
  for (const entry of edition.entries) {
    const company = byId.get(entry.company);
    if (!company) throw new Error(`edition ${edition.id} lists unknown company "${entry.company}"`);
    const row = rows.get(company.id) ?? { company, groups: [] };
    if (!row.groups.includes(entry.group)) row.groups.push(entry.group);
    rows.set(company.id, row);
  }
  for (const row of rows.values()) row.groups.sort((a, b) => groupOrder(a) - groupOrder(b));
  return [...rows.values()].sort((a, b) => byName(a.company, b.company));
}

export interface Count {
  key: string;
  count: number;
}

/** Counts by key, largest first, ties A to Z, so charts and tables agree. */
export function countBy<T>(items: readonly T[], key: (item: T) => string | undefined): Count[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "en"));
}

/**
 * The first `n` of a countBy() list, plus every entry tied with the nth, so a
 * "largest" summary never names one side of a tie and drops the other.
 */
export function topWithTies(counts: readonly Count[], n: number): Count[] {
  const cutoff = counts[n - 1]?.count;
  return cutoff === undefined ? [...counts] : counts.filter((c) => c.count >= cutoff);
}

export interface YearCount {
  year: number;
  count: number;
}

/** Companies per founding year, oldest first. Companies with no sourced year are left out. */
export function foundingYears(rows: readonly BoardRow[]): YearCount[] {
  const counts = new Map<number, number>();
  for (const { company } of rows) {
    if (company.founded_year !== undefined) counts.set(company.founded_year, (counts.get(company.founded_year) ?? 0) + 1);
  }
  return [...counts].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year);
}

/** The latest edition by publish date, or undefined when there is none. */
export function latestEdition(editions: readonly Edition[]): Edition | undefined {
  return [...editions].sort((a, b) => b.published.localeCompare(a.published))[0];
}
