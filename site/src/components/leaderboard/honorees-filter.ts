// The honorees filter's rules, apart from the DOM so a unit test can run
// them. A row shows when it fits every filter set: the sector and the HQ
// city exactly, and each search word somewhere in its name or description.
// Case and accents never matter to the search.

export interface HonoreeFacts {
  name: string;
  description: string;
  sector: string;
  city: string;
}

export interface HonoreeFilters {
  q?: string;
  sector?: string;
  city?: string;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

export function matchesHonoree(row: HonoreeFacts, f: HonoreeFilters): boolean {
  if (f.sector && row.sector !== f.sector) return false;
  if (f.city && row.city !== f.city) return false;
  const hay = fold(`${row.name} ${row.description}`);
  return fold(f.q ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** The live status line under the filters. */
export function honoreeCount(shown: number, total: number): string {
  if (shown === total) return `Showing all ${total} companies.`;
  if (shown === 0) return "No company fits these filters. Clear one to see more.";
  return `Showing ${shown} of ${total} companies.`;
}

/** Distinct values, A to Z, for a filter's options. */
export function optionsFrom(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}
