// Pure filter logic for the directory, shared by the island and its tests.
// No DOM, no network.

export interface FilterState {
  stage: string;
  /**
   * The kind within a stage. Only from a link, such as a Start here browse
   * row (step L1b): no control sets it. A chip beside the count line shows
   * and removes it; a new stage or Clear drops it (canvas-filters.ts).
   */
  substage?: string;
  type: string;
  city: string;
  q: string;
}

export interface CardFacts {
  id: string;
  stage: string;
  substage?: string;
  type: string;
  city: string;
  text: string;
}

const KEYS = ["stage", "substage", "type", "city", "q"] as const;

// Support sits alongside every level of the journey, so a chosen level also
// shows the Support group. Choosing Support itself shows only that group.
const ALONGSIDE = "support";

/** Rows the list shows at first, and how many more each "Show more" adds. */
export const PAGE_SIZE = 24;

/** Reads a filter state from a query string, keeping only allowed values. */
export function readState(
  search: string,
  allowed: { stage: Set<string>; substage?: Set<string>; type: Set<string>; city: Set<string> },
): FilterState {
  const params = new URLSearchParams(search);
  const pick = (key: "stage" | "type" | "city") => {
    const v = params.get(key) ?? "";
    return allowed[key].has(v) ? v : "";
  };
  const substage = params.get("substage") ?? "";
  const state: FilterState = { stage: pick("stage"), type: pick("type"), city: pick("city"), q: (params.get("q") ?? "").slice(0, 100) };
  if (substage && allowed.substage?.has(substage)) state.substage = substage;
  return state;
}

/** The directory filtered to one stage and substage, for a browse row's link. */
export function browseHref(stage: string, substage: string): string {
  return `/ecosystem-canvas/${writeState({ stage, substage, type: "", city: "", q: "" })}`;
}

// Every parameter that narrows the list. "region" comes from a region page's
// "See all" link; the island does not filter on it yet, but the visitor came
// for the list, so it opens on the list too.
const LIST_PARAMS = [...KEYS, "region"] as const;

/**
 * True when the URL carries any filter or search parameter, so the page
 * opens on the full list (step L1b) instead of the picks alone.
 */
export function opensOnList(search: string): boolean {
  const params = new URLSearchParams(search);
  return LIST_PARAMS.some((key) => (params.get(key) ?? "").trim() !== "");
}

/** The query string for a state, with empty values left out. */
export function writeState(state: FilterState): string {
  const params = new URLSearchParams();
  for (const key of KEYS) if (state[key]) params.set(key, state[key]);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function terms(q: string): string[] {
  return q
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * True when a card passes the select filters and the text query.
 * `searchHits` is the set of ids a Pagefind search returned; when it is null
 * the query is matched against the card's own text instead.
 */
export function matches(card: CardFacts, state: FilterState, searchHits: Set<string> | null): boolean {
  if (state.stage && card.stage !== state.stage && card.stage !== ALONGSIDE) return false;
  if (state.substage && card.substage !== state.substage) return false;
  if (state.type && card.type !== state.type) return false;
  if (state.city && card.city !== state.city) return false;
  if (!state.q.trim()) return true;
  if (searchHits) return searchHits.has(card.id);
  const hay = card.text.toLowerCase().normalize("NFKD");
  return terms(state.q).every((t) => hay.includes(t));
}

/**
 * Each stage's count under the other filters, for the journey's stage
 * chips: what a visitor would see in that stage after choosing it. The empty
 * key counts every stage, for the "All" chip.
 */
export function stageCounts(
  cards: readonly CardFacts[],
  state: FilterState,
  searchHits: Set<string> | null,
): Record<string, number> {
  const others = { ...state, stage: "" };
  const counts: Record<string, number> = { "": 0 };
  for (const card of cards) {
    if (!matches(card, others, searchHits)) continue;
    counts[""] += 1;
    counts[card.stage] = (counts[card.stage] ?? 0) + 1;
  }
  return counts;
}

/** Which rows show: the first `limit` matches, in page order. */
export function pageOf(matched: readonly boolean[], limit: number): boolean[] {
  let n = 0;
  return matched.map((m) => m && n++ < limit);
}

/**
 * The limit that shows the match at `index` (a row a link points to), in
 * whole pages and never below `limit`. A row that does not match keeps the limit.
 */
export function limitFor(matched: readonly boolean[], index: number, limit: number): number {
  if (!matched[index]) return limit;
  const rank = matched.slice(0, index + 1).filter(Boolean).length;
  return Math.max(limit, Math.ceil(rank / PAGE_SIZE) * PAGE_SIZE);
}

/** "All 501 resources." or "37 of 501 resources match." */
export function countText(matched: number, total: number): string {
  const noun = total === 1 ? "resource" : "resources";
  return matched === total ? `All ${total} ${noun}.` : `${matched} of ${total} ${noun} match.`;
}

/** "Showing 24 of 245." under the list. */
export function shownText(shown: number, matched: number): string {
  return `Showing ${shown} of ${matched}.`;
}

/** "Show 24 more", or fewer when fewer are left. */
export function moreText(left: number): string {
  return `Show ${Math.min(left, PAGE_SIZE)} more`;
}

/** "12 resources", the badge beside a stage heading. */
export function groupCountText(n: number): string {
  return `${n} ${n === 1 ? "resource" : "resources"}`;
}

/** Ids from Pagefind sub-results that point into this page ("/ecosystem-canvas/#acme"). */
export function idsFromSubResults(urls: string[], pagePath: string): Set<string> {
  const ids = new Set<string>();
  for (const u of urls) {
    const hash = u.indexOf("#");
    if (hash < 0) continue;
    const path = u.slice(0, hash).replace(/^https?:\/\/[^/]+/, "");
    if (path !== pagePath) continue;
    ids.add(decodeURIComponent(u.slice(hash + 1)));
  }
  return ids;
}
