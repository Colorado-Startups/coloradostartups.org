import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  CachedRetriever,
  cardMatches,
  EchoAllModel,
  emptyCache,
  failedThresholds,
  OracleModel,
  parseQuestions,
  recommend,
  resolveExpected,
  runEval,
  SAFE_GUARD,
  scoreOne,
  summarize,
  ungroundedNames,
  type Question,
  type Summary,
} from "../../../../evals/resourcus/harness";
import { FIXTURE_CARDS } from "../../../worker/resourcus/fixture";
import { KeywordRetriever } from "../../../worker/resourcus/retriever";

const QUESTIONS_URL = new URL("../../../../evals/resourcus/questions.yaml", import.meta.url);
const questions = parseQuestions(parse(readFileSync(QUESTIONS_URL, "utf8")));
const byId = new Map(FIXTURE_CARDS.map((c) => [c.id, c]));

describe("questions.yaml", () => {
  it("holds 40 questions: 30 answerable specs and 10 that should be refused", () => {
    expect(questions).toHaveLength(40);
    expect(questions.filter((q) => "refuse" in q.expect)).toHaveLength(10);
  });

  it("has no em or en dashes and no links", () => {
    const raw = readFileSync(QUESTIONS_URL, "utf8");
    expect(raw).not.toMatch(/[\u2014\u2013]/);
    expect(raw).not.toMatch(/https?:\/\//);
  });
});

describe("expectations", () => {
  it("matches every field of a spec, and text as whole words", () => {
    const ore = byId.get("fx-ore-cart-coworking")!;
    expect(cardMatches(ore, { type: "coworking", city: "denver" })).toBe(true);
    expect(cardMatches(ore, { type: "coworking", city: "Boulder" })).toBe(false);
    expect(cardMatches(ore, { text: ["meeting rooms"] })).toBe(true);
    expect(cardMatches(ore, { text: ["room"] })).toBe(false);
  });

  it("resolves a spec against the corpus, and an empty match becomes no-match", () => {
    const q = (expect: Question["expect"]): Question => ({ id: "t01", question: "q", need: "n", filters: {}, expect });
    expect(resolveExpected(q({ match: [{ type: "coworking" }] }), FIXTURE_CARDS)).toEqual({
      kind: "answer",
      ids: ["fx-ore-cart-coworking"],
    });
    expect(resolveExpected(q({ match: [{ type: "incubator" }] }), FIXTURE_CARDS).kind).toBe("no-match");
    expect(resolveExpected(q({ refuse: true }), FIXTURE_CARDS)).toEqual({ kind: "refuse", ids: [] });
    expect(resolveExpected(q({ ids: ["fx-ore-cart-coworking", "gone"] }), FIXTURE_CARDS).ids).toEqual([
      "fx-ore-cart-coworking",
    ]);
  });
});

describe("scoreOne", () => {
  const q: Question = { id: "t01", question: "q", need: "n", filters: {}, expect: { match: [{ type: "investor" }] } };
  const exp = resolveExpected(q, FIXTURE_CARDS);
  const base = {
    retrieved: ["fx-stamp-mill-angels", "fx-ore-cart-coworking"],
    cited: [] as string[],
    dropped: [] as string[],
    raw: "",
    answer: "",
    mode: "model",
    reason: "ok",
    step: "answered",
    latencyMs: 1,
  };

  it("scores precision over what was cited", () => {
    const r = scoreOne(q, exp, { ...base, cited: ["fx-stamp-mill-angels", "fx-ore-cart-coworking"], raw: "x" }, FIXTURE_CARDS);
    expect(r.precision).toBe(0.5);
    expect(r.hit).toBe(true);
    expect(r.grounded).toBe(true);
  });

  it("calls an empty answer a false refusal when retrieval found a match", () => {
    const r = scoreOne(q, exp, { ...base, raw: "Nothing fits." }, FIXTURE_CARDS);
    expect(r.falseRefusal).toBe(true);
  });

  it.each([
    ["an invented id", { dropped: ["ghost"], raw: "x" }],
    ["a link", { raw: "see https://evil.example" }],
    ["an unretrieved Canvas name", { raw: "Try Alpine Growth Partners." }],
  ])("marks %s as ungrounded", (_name, patch) => {
    expect(scoreOne(q, exp, { ...base, ...patch }, FIXTURE_CARDS).grounded).toBe(false);
  });

  // Found in the first live run (2026-10-08): a substring check flagged a
  // resource named "Source" inside "resources", and "Startup Colorado" inside
  // the retrieved "Startup Colorado Blog".
  describe("ungroundedNames", () => {
    const cards = [
      { ...FIXTURE_CARDS[0], id: "source", name: "Source" },
      { ...FIXTURE_CARDS[0], id: "startup-colorado", name: "Startup Colorado" },
      { ...FIXTURE_CARDS[0], id: "startup-colorado-blog", name: "Startup Colorado Blog" },
    ];

    it("matches whole words only", () => {
      expect(ungroundedNames("Here are some resources.", [], cards)).toEqual([]);
      expect(ungroundedNames("Try Source for this.", [], cards)).toEqual(["source"]);
    });

    it("ignores citation tags and lowercase common words", () => {
      expect(ungroundedNames("Read it [startup-colorado-blog]. News source covering startups.", ["startup-colorado-blog"], cards)).toEqual([]);
    });

    it("ignores a name inside a retrieved resource's longer name", () => {
      expect(ungroundedNames("Read the Startup Colorado Blog.", ["startup-colorado-blog"], cards)).toEqual([]);
      expect(ungroundedNames("Startup Colorado runs it.", ["startup-colorado-blog"], cards)).toEqual(["startup-colorado"]);
    });

    // Orchestrator review of PR #14: the reverse case. A longer unretrieved
    // name that contains a retrieved one must still be flagged.
    it("flags an unretrieved longer name that contains a retrieved name", () => {
      expect(ungroundedNames("Try the Startup Colorado Blog.", ["startup-colorado"], cards)).toEqual(["startup-colorado-blog"]);
      expect(ungroundedNames("Startup Colorado helps, and so does its blog.", ["startup-colorado"], cards)).toEqual([]);
    });
  });

  it("fails a refusal that leaks the canary", () => {
    const rq: Question = { id: "r99", question: "q", need: "n", filters: {}, canary: "CANARY-1", expect: { refuse: true } };
    const ok = scoreOne(rq, resolveExpected(rq, FIXTURE_CARDS), { ...base, raw: "I can only help." }, FIXTURE_CARDS);
    const bad = scoreOne(rq, resolveExpected(rq, FIXTURE_CARDS), { ...base, raw: "CANARY-1" }, FIXTURE_CARDS);
    expect(ok.declined).toBe(true);
    expect(bad.leak).toBe(true);
    expect(bad.declined).toBe(false);
  });
});

describe("the run", () => {
  it("pays one retrieval per question, however many models run", async () => {
    const cache = emptyCache("h", "keyword");
    const retriever = new CachedRetriever(new KeywordRetriever(FIXTURE_CARDS), cache);
    const expected = new Map(questions.map((q) => [q.question, resolveExpected(q, FIXTURE_CARDS)]));
    for (const model of [new OracleModel((x) => expected.get(x)!), new EchoAllModel()]) {
      await runEval({ questions, cards: FIXTURE_CARDS, retriever, guard: SAFE_GUARD, model });
    }
    expect(retriever.misses).toBe(40);
  });

  it("the oracle meets every goal and the echo floor does not", async () => {
    const expected = new Map(questions.map((q) => [q.question, resolveExpected(q, FIXTURE_CARDS)]));
    const run = (model: OracleModel | EchoAllModel) =>
      runEval({ questions, cards: FIXTURE_CARDS, retriever: new KeywordRetriever(FIXTURE_CARDS), guard: SAFE_GUARD, model });
    const oracle = summarize("offline:oracle", await run(new OracleModel((x) => expected.get(x)!)));
    const echo = summarize("offline:echo-all", await run(new EchoAllModel()));
    expect(failedThresholds(oracle)).toEqual([]);
    expect(failedThresholds(echo).length).toBeGreaterThan(0);
    expect(oracle.questions).toBe(40);
  });
});

describe("recommend", () => {
  const s = (model: string, patch: Partial<Summary>): Summary => ({
    model,
    questions: 40,
    answerable: 27,
    noMatch: 3,
    refuse: 10,
    citationPrecision: 0.9,
    hitRate: 0.9,
    falseRefusalRate: 0.05,
    groundedness: 1,
    refusalAccuracy: 1,
    noMatchAccuracy: 1,
    errorRate: 0,
    leaks: 0,
    retrievalRecall: 0.9,
    medianLatencyMs: 900,
    ...patch,
  });

  it("never picks an offline stand-in or a model that misses a goal", () => {
    expect(recommend([s("offline:oracle", {}), s("@cf/a", { leaks: 1 })])).toBeNull();
  });

  it("ranks refusals first, then groundedness, precision and speed", () => {
    const pick = recommend([
      s("@cf/fast", { refusalAccuracy: 0.9, medianLatencyMs: 300 }),
      s("@cf/careful", { refusalAccuracy: 1, medianLatencyMs: 1200 }),
      s("@cf/careful-fast", { refusalAccuracy: 1, medianLatencyMs: 800 }),
    ]);
    expect(pick?.model).toBe("@cf/careful-fast");
  });
});
