import { ResourceCardSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { FIXTURE_CARDS } from "../../worker/resourcus/fixture";
import { KeywordRetriever, tokenize } from "../../worker/resourcus/retriever";

describe("fixture", () => {
  it("has twenty valid cards, all fictional on example.org", () => {
    expect(FIXTURE_CARDS).toHaveLength(20);
    for (const c of FIXTURE_CARDS) {
      expect(ResourceCardSchema.safeParse(c).success).toBe(true);
      expect(c.url.startsWith("https://example.org/")).toBe(true);
      expect(c.id.startsWith("fx-")).toBe(true);
    }
  });
});

describe("KeywordRetriever", () => {
  const r = new KeywordRetriever(FIXTURE_CARDS);

  it("drops stop words, including colorado and startup", () => {
    expect(tokenize("Where can I find a Colorado startup accelerator?")).toEqual(["find", "accelerator"]);
  });

  it("ranks the obvious match first", async () => {
    const hits = await r.search("coworking desks in Denver", { limit: 3 });
    expect(hits[0]?.id).toBe("fx-ore-cart-coworking");
  });

  it("applies stage and city filters", async () => {
    const hits = await r.search("investor", { limit: 10, filters: { stage: "growth" } });
    expect(hits.map((h) => h.id)).toEqual(["fx-alpine-growth-partners"]);
  });

  it("returns nothing for an empty query", async () => {
    expect(await r.search("the and of", { limit: 5 })).toEqual([]);
  });
});
