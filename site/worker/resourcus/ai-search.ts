// AiSearchRetriever: hybrid search on the RESOURCUS_SEARCH binding, behind the
// same Retriever interface as KeywordRetriever.
//
// Corpus contract with L3 (scripts/canvas/lib/corpus.mjs, decision 38): one
// document per resource, keyed `cs-resource--<id>--<sha256-16>.md`, with
// custom metadata resource_id, stage, type and city. The id comes from
// metadata `resource_id`, else from between the two "--" in the key, else
// from a plain `<id>.md` key. City is not sent as a filter
// because metadata filters match exact strings; the core filters city against
// our own cards after retrieval instead.

import { SlugSchema, type ResourceFilters } from "@cs/shared";

import type { RetrieveOptions, RetrievedResource, Retriever } from "./retriever";

interface Chunk {
  score: number;
  text: string;
  item: { key: string; metadata?: Record<string, unknown> };
}

// The slice of AiSearchInstance we use. env.RESOURCUS_SEARCH satisfies it.
export interface AiSearchLike {
  search(params: { query: string; ai_search_options?: Record<string, unknown> }): Promise<{ chunks: Chunk[] }>;
}

const CORPUS_KEY = /^cs-resource--([a-z0-9-]+?)--[0-9a-f]{16}\.md$/;

// The resource id an AI Search chunk belongs to: its resource_id metadata, else
// the slug in its corpus file name. Null when that is not a valid slug.
export function idFromChunk(chunk: Chunk): string | null {
  const meta = chunk.item.metadata?.resource_id;
  const base = chunk.item.key.split("/").pop() ?? "";
  const raw =
    typeof meta === "string" ? meta : (CORPUS_KEY.exec(base)?.[1] ?? base.replace(/\.[a-z0-9]+$/i, ""));
  return SlugSchema.safeParse(raw).success ? raw : null;
}

// AI Search metadata filters for the stage and type a visitor picked, or
// undefined when neither is set. City is checked after retrieval (matchesFilters).
export function searchFilters(filters: ResourceFilters | undefined): Record<string, string> | undefined {
  if (!filters) return undefined;
  const out: Record<string, string> = {};
  if (filters.stage) out.stage = filters.stage;
  if (filters.type) out.type = filters.type;
  return Object.keys(out).length > 0 ? out : undefined;
}

// AI Search caps max_num_results at 50 (AiSearchOptions in the runtime types).
const MAX_RESULTS = 50;

export class AiSearchRetriever implements Retriever {
  constructor(private readonly instance: AiSearchLike) {}

  async search(query: string, { filters, limit }: RetrieveOptions): Promise<RetrievedResource[]> {
    const res = await this.instance.search({
      query,
      ai_search_options: {
        retrieval: {
          retrieval_type: "hybrid",
          // Over-fetch: several chunks can share one resource, and the city
          // filter runs afterwards.
          max_num_results: Math.min(MAX_RESULTS, Math.max(limit * 3, 10)),
          filters: searchFilters(filters),
          // Surface failures as errors so the core can say reason "error",
          // instead of an empty list that reads as "no match".
          return_on_failure: false,
        },
        // Both would spend extra model calls the budget guard does not count.
        query_rewrite: { enabled: false },
        reranking: { enabled: false },
      },
    });
    const best = new Map<string, RetrievedResource>();
    for (const chunk of res.chunks ?? []) {
      const id = idFromChunk(chunk);
      if (!id) continue;
      const prev = best.get(id);
      if (!prev || chunk.score > prev.score) best.set(id, { id, score: chunk.score, text: chunk.text });
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }
}
