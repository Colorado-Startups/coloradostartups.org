// The three adapters, against recorded responses in each provider's
// documented shape, plus the HTTP layer's retries and the cost math.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { costOf, estimate, parsePricing } from "../cost.ts";
import { scoreAnswer } from "../panel.ts";
import { anthropic, HttpError, isAuthError, makePost, parseAnthropic, parseOpenAI, parsePerplexity } from "../providers.ts";
import { ANTHROPIC, fakeFetch, fixture, happyRoutes } from "./helpers.ts";

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { ROOT } from "./helpers.ts";

const pricing = parsePricing(parse(readFileSync(path.join(ROOT, "pricing.yaml"), "utf8")));

describe("anthropic", () => {
  it("joins a pause_turn continuation into one answer", () => {
    const a = parseAnthropic(fixture("anthropic-pause-then-answer.json") as unknown[]);
    assert.match(a.text, /^Here are the main communities/);
    assert.deepEqual(a.citedUrls, ["https://frontrangefounders.example/about", "https://coloradostartups.org/resources/"]);
    assert.deepEqual(a.searchResultUrls, ["https://coloradostartups.org/resources/", "https://frontrangefounders.example/about"]);
    assert.equal(a.stopReason, "end_turn");
    assert.deepEqual(a.usage, { inputTokens: 13000, outputTokens: 920, searches: 3, requests: 2, contextSize: null });

    const s = scoreAnswer(a.text, a.citedUrls);
    assert.equal(s.named, true);
    assert.equal(s.cited, true);
    assert.deepEqual(s.citedVia, ["citation"]);
    assert.equal(s.position?.rank, 2);
    // The closing "Colorado startups at any stage" is the generic phrase.
    assert.equal(s.mentions.length, 1);
  });

  it("reads a search error block as no results, not a crash", () => {
    const a = parseAnthropic(fixture("anthropic-search-error.json") as unknown[]);
    assert.deepEqual(a.searchResultUrls, []);
    assert.equal(scoreAnswer(a.text, a.citedUrls).named, false);
  });

  it("sends the paused content back, with the web search tool, and the key only in a header", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const post = makePost({ fetch, sleep: async () => {}, timeoutMs: 1000, retries: 0 });
    const a = await anthropic.ask("Q?", "claude-sonnet-5-5", "k-test", post);
    assert.equal(calls.length, 2);
    const [first, second] = calls as [(typeof calls)[0], (typeof calls)[0]];
    assert.ok(first.url.startsWith(ANTHROPIC));
    assert.equal(first.headers["x-api-key"], "k-test");
    assert.equal(first.headers["anthropic-version"], "2023-06-01");
    const body1 = first.body as { model: string; tools: { type: string }[]; messages: unknown[] };
    assert.equal(body1.model, "claude-sonnet-5-5");
    assert.equal(body1.tools[0]!.type, "web_search_20260209");
    assert.equal(body1.messages.length, 1);
    const body2 = second.body as { messages: { role: string; content: unknown[] }[] };
    assert.equal(body2.messages[1]!.role, "assistant");
    assert.equal(body2.messages[1]!.content.length, 2);
    assert.ok(!JSON.stringify(first.body).includes("k-test"));
    assert.equal(a.usage.requests, 2);
  });
});

describe("openai", () => {
  it("reads output_text, url_citation annotations and search sources", () => {
    const a = parseOpenAI(fixture("openai-cited-in-text.json"));
    assert.deepEqual(a.citedUrls, ["https://mountainmakers.example/?utm_source=openai", "https://coloradostartups.org/resources/?utm_source=openai"]);
    assert.deepEqual(a.searchResultUrls, ["https://www.coloradostartups.org/resources/", "https://mountainmakers.example/"]);
    assert.equal(a.usage.searches, 1, "open_page is not a search");
    assert.equal(a.stopReason, "completed");
    const s = scoreAnswer(a.text, a.citedUrls);
    assert.equal(s.named, true, "the domain as link text names us");
    assert.deepEqual(s.citedVia, ["citation", "text"]);
    assert.equal(s.position?.rank, 3);
    assert.equal(s.position?.units, 3);
  });

  it("records an incomplete response with its reason", () => {
    const a = parseOpenAI(fixture("openai-incomplete.json"));
    assert.equal(a.stopReason, "incomplete:max_output_tokens");
    assert.equal(scoreAnswer(a.text, a.citedUrls).named, false);
  });
});

describe("perplexity", () => {
  it("reads content, citations, search results and the context size", () => {
    const a = parsePerplexity(fixture("perplexity-named-in-lead.json"));
    assert.equal(a.citedUrls.length, 3);
    assert.equal(a.usage.contextSize, "low");
    const s = scoreAnswer(a.text, a.citedUrls);
    assert.equal(s.named, true);
    assert.equal(s.position?.unit, "heading");
    assert.equal(s.position?.inLead, true);
    assert.equal(s.namedFirst, true);
    assert.deepEqual(s.citedVia, ["citation"]);
  });

  it("scores look-alikes as neither named nor cited", () => {
    const a = parsePerplexity(fixture("perplexity-false-friends.json"));
    const s = scoreAnswer(a.text, a.citedUrls);
    assert.equal(s.named, false);
    assert.equal(s.cited, false);
    assert.equal(a.usage.contextSize, null);
  });
});

describe("http", () => {
  it("retries a 429 and a 500, then returns the body", async () => {
    let n = 0;
    const slept: number[] = [];
    const fetch = (async () => {
      n += 1;
      if (n === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "3" } });
      if (n === 2) return new Response("oops", { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;
    const post = makePost({ fetch, sleep: async (ms) => void slept.push(ms), timeoutMs: 1000, retries: 2 });
    assert.deepEqual(await post("https://x.example/", {}, {}), { ok: true });
    assert.deepEqual(slept, [3000, 4000]);
  });

  it("does not retry a 401, and marks it as an auth error", async () => {
    let n = 0;
    const fetch = (async () => {
      n += 1;
      return new Response("bad key", { status: 401 });
    }) as typeof globalThis.fetch;
    const post = makePost({ fetch, sleep: async () => {}, timeoutMs: 1000, retries: 2 });
    await assert.rejects(post("https://x.example/", {}, {}), (err) => err instanceof HttpError && isAuthError(err));
    assert.equal(n, 1);
  });
});

describe("cost", () => {
  it("prices one answer from its usage", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 100_000, searches: 10, requests: 1, contextSize: null };
    // $2 input + $1 output + $0.10 search, at pricing.yaml's Anthropic rates.
    assert.equal(costOf(pricing.anthropic, u).toFixed(2), "3.10");
    // Perplexity charges the request fee by context size; unknown is charged high.
    const p = { inputTokens: 0, outputTokens: 0, searches: 0, requests: 1, contextSize: null };
    assert.equal(costOf(pricing.perplexity, { ...p, contextSize: "low" }), 0.005);
    assert.equal(costOf(pricing.perplexity, p), 0.012);
  });

  it("estimates from the assumptions in pricing.yaml", () => {
    const e = estimate(pricing, ["anthropic", "openai", "perplexity"], 20);
    assert.deepEqual(
      e.map((x) => x.total.toFixed(2)),
      ["2.60", "4.40", "0.30"],
    );
    assert.ok(e.every((x) => x.source.startsWith("https://") && x.read === "2026-10-18"));
  });
});
