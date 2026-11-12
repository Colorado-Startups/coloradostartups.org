import { describe, expect, it } from "vitest";

import { AiSearchRetriever, idFromChunk, searchFilters, type AiSearchLike } from "../../../worker/resourcus/ai-search";
import { parseCap, periodOf } from "../../../worker/resourcus/budget";
import { isUsableSessionId, sha256Hex } from "../../../worker/resourcus/session";

const chunk = (key: string, score: number, metadata?: Record<string, unknown>) => ({
  score,
  text: `text for ${key}`,
  item: { key, metadata },
});

describe("idFromChunk", () => {
  it("prefers metadata resource_id, else the key without extension", () => {
    expect(idFromChunk(chunk("anything.md", 1, { resource_id: "fx-ore-cart-coworking" }))).toBe("fx-ore-cart-coworking");
    expect(idFromChunk(chunk("resources/launch/fx-ore-cart-coworking.md", 1))).toBe("fx-ore-cart-coworking");
  });

  it("reads L3's corpus keys, cs-resource--<id>--<sha256-16>.md", () => {
    expect(idFromChunk(chunk("cs-resource--fx-ore-cart-coworking--0123456789abcdef.md", 1))).toBe("fx-ore-cart-coworking");
    expect(idFromChunk(chunk("cs-resource--fx-a--0123456789abcdef.md", 1, { resource_id: "fx-b" }))).toBe("fx-b");
  });

  it("rejects ids that are not slugs", () => {
    expect(idFromChunk(chunk("Bad Name.md", 1))).toBeNull();
    expect(idFromChunk(chunk("x.md", 1, { resource_id: "../etc" }))).toBeNull();
  });
});

describe("searchFilters", () => {
  it("sends stage and type, never city", () => {
    expect(searchFilters({ stage: "launch", type: "investor", city: "Denver" })).toEqual({
      stage: "launch",
      type: "investor",
    });
    expect(searchFilters({ city: "Denver" })).toBeUndefined();
    expect(searchFilters(undefined)).toBeUndefined();
  });
});

describe("AiSearchRetriever", () => {
  it("asks for hybrid retrieval without rewrite or rerank, then dedupes by resource", async () => {
    const seen: unknown[] = [];
    const fake: AiSearchLike = {
      search: async (params) => {
        seen.push(params);
        return {
          chunks: [
            chunk("b.md", 0.5),
            chunk("a.md", 0.7),
            chunk("a.md", 0.9),
            chunk("Not A Slug.md", 0.99),
            chunk("c.md", 0.2),
          ],
        };
      },
    };
    const hits = await new AiSearchRetriever(fake).search("cowork", { limit: 2, filters: { stage: "launch" } });
    expect(hits.map((h) => [h.id, h.score])).toEqual([
      ["a", 0.9],
      ["b", 0.5],
    ]);
    expect(seen[0]).toMatchObject({
      query: "cowork",
      ai_search_options: {
        retrieval: { retrieval_type: "hybrid", filters: { stage: "launch" }, return_on_failure: false },
        query_rewrite: { enabled: false },
        reranking: { enabled: false },
      },
    });
  });

  it("lets a search error reach the caller", async () => {
    const fake: AiSearchLike = { search: async () => Promise.reject(new Error("instance not found")) };
    await expect(new AiSearchRetriever(fake).search("x", { limit: 3 })).rejects.toThrow(/not found/);
  });
});

describe("budget helpers", () => {
  it("reads caps as whole numbers and anything else as zero (fail closed)", () => {
    expect(parseCap("3000")).toBe(3000);
    expect(parseCap(" 300 ")).toBe(300);
    expect(parseCap(12)).toBe(12);
    for (const bad of [undefined, "", "-1", "1e3", "abc", "3.5", null]) expect(parseCap(bad)).toBe(0);
  });

  it("counts by UTC calendar month", () => {
    expect(periodOf(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(periodOf(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});

describe("session ids", () => {
  it("accepts random UUIDs and rejects short or odd ids", () => {
    expect(isUsableSessionId(crypto.randomUUID())).toBe(true);
    for (const bad of [undefined, "", "short", "has spaces in it okay", "x".repeat(65), "<script>alert(1)</script>"]) {
      expect(isUsableSessionId(bad)).toBe(false);
    }
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
