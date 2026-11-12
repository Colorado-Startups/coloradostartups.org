// The Retriever seam. Resourcus asks a Retriever for candidate resources and
// never cares where they came from. Two implementations:
//   - KeywordRetriever (here): term overlap over ResourceCards. Used by tests
//     (offline, deterministic) and as the fallback when the model or search
//     budget is spent.
//   - AiSearchRetriever (L4, worker/resourcus/ai-search.ts): hybrid search on
//     the RESOURCUS_SEARCH binding.

import type { ResourceCard, ResourceFilters } from "@cs/shared";

export interface RetrievedResource {
  id: string;
  score: number;
  // The text the model may read. Treated as data, never as instructions.
  text: string;
}

export interface RetrieveOptions {
  filters?: ResourceFilters;
  limit: number;
}

export interface Retriever {
  search(query: string, options: RetrieveOptions): Promise<RetrievedResource[]>;
}

const STOP = new Set([
  "a", "an", "and", "are", "can", "do", "for", "how", "i", "in", "is", "me", "my",
  "of", "on", "or", "the", "to", "we", "what", "where", "which", "who", "with",
  "colorado", "startup", "startups",
]);

// Lowercase word tokens for keyword search, with accents, punctuation and
// stop words removed.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// One card as plain text: name, description, type, stage and city.
export function cardText(c: ResourceCard): string {
  return `${c.name}. ${c.description} Type: ${c.type}. Stage: ${c.stage} (${c.substage}). City: ${c.city}.`;
}

// True when a card fits every filter the visitor set: stage, type and city
// (city ignores case).
export function matchesFilters(c: ResourceCard, f: ResourceFilters | undefined): boolean {
  if (!f) return true;
  if (f.stage && c.stage !== f.stage) return false;
  if (f.type && c.type !== f.type) return false;
  if (f.city && c.city.toLowerCase() !== f.city.toLowerCase()) return false;
  return true;
}

export class KeywordRetriever implements Retriever {
  constructor(private readonly cards: readonly ResourceCard[]) {}

  async search(query: string, { filters, limit }: RetrieveOptions): Promise<RetrievedResource[]> {
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    const scored: RetrievedResource[] = [];
    for (const c of this.cards) {
      if (!matchesFilters(c, filters)) continue;
      const hay = tokenize(`${c.name} ${c.description} ${c.type} ${c.substage} ${c.city} ${c.stage}`);
      let score = 0;
      for (const t of hay) if (terms.has(t)) score += 1;
      // Name hits count double: people ask for things by name.
      for (const t of tokenize(c.name)) if (terms.has(t)) score += 1;
      if (score > 0) scored.push({ id: c.id, score, text: cardText(c) });
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, limit);
  }
}
