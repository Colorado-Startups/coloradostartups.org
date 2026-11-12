// Pure filter logic for the directory, shared by the island and its tests.
// No DOM, no network.

export interface FilterState {
  stage: string;
  type: string;
  city: string;
  q: string;
}

export interface CardFacts {
  id: string;
  stage: string;
  type: string;
  city: string;
  text: string;
}

const KEYS = ["stage", "type", "city", "q"] as const;

// Support sits alongside every level of the journey, so a chosen level also
// shows the Support group. Choosing Support itself shows only that group.
const ALONGSIDE = "support";

/** Reads a filter state from a query string, keeping only allowed values. */
export function readState(search: string, allowed: { stage: Set<string>; type: Set<string>; city: Set<string> }): FilterState {
  const params = new URLSearchParams(search);
  const pick = (key: "stage" | "type" | "city") => {
    const v = params.get(key) ?? "";
    return allowed[key].has(v) ? v : "";
  };
  return { stage: pick("stage"), type: pick("type"), city: pick("city"), q: (params.get("q") ?? "").slice(0, 100) };
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
  if (state.type && card.type !== state.type) return false;
  if (state.city && card.city !== state.city) return false;
  if (!state.q.trim()) return true;
  if (searchHits) return searchHits.has(card.id);
  const hay = card.text.toLowerCase().normalize("NFKD");
  return terms(state.q).every((t) => hay.includes(t));
}

/** "Showing 12 of 548 resources." */
export function countText(shown: number, total: number): string {
  const noun = total === 1 ? "resource" : "resources";
  return shown === total ? `Showing all ${total} ${noun}.` : `Showing ${shown} of ${total} ${noun}.`;
}

/** "12 resources", the badge beside a substage heading. */
export function groupCountText(n: number): string {
  return `${n} ${n === 1 ? "resource" : "resources"}`;
}

export type Ground = "band" | "lit";

/**
 * A ground for each section, alternating over the sections still showing and
 * starting from the first section's ground. A hidden section gets null and
 * keeps the class it has.
 */
export function grounds(visible: boolean[], first: Ground): (Ground | null)[] {
  let n = 0;
  return visible.map((shown) => {
    if (!shown) return null;
    const likeFirst = n++ % 2 === 0;
    return likeFirst === (first === "band") ? "band" : "lit";
  });
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
