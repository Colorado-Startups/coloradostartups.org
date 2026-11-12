// The grounding check against real model output: every answer the three
// candidate models gave in the live eval (evals/resourcus/results/, run
// 2026-10-09 on resourcus-staging) is put through checkGrounding(). Each
// rejected answer becomes a fallback, as in answer.ts, and the run is scored
// again with the eval harness. The scores must not move: the guard may cost
// these answers nothing on precision, hit rate, false refusals, refusals,
// honest no-match or leaks.
//
// When a new live run rewrites those files, this test reads the new answers.
// A failure there means the guard rejects a grounded answer a model wrote.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ResourceSchema, toCard, type ResourceCard } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  parseQuestions,
  scoreOne,
  summarize,
  type QuestionResult,
  type Summary,
} from "../../../../evals/resourcus/harness";
import { checkGrounding } from "../../../worker/resourcus/grounding";
import { FALLBACK_INTRO } from "../../../worker/resourcus/prompt";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RESULTS = path.join(ROOT, "evals/resourcus/results");

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return yamlFiles(p);
    return /\.ya?ml$/.test(name) ? [p] : [];
  });
}

const cards: ResourceCard[] = yamlFiles(path.join(ROOT, "data/resources"))
  .map((f) => ResourceSchema.parse(parse(readFileSync(f, "utf8"))))
  .filter((r) => r.status === "active")
  .map(toCard);
const byId = new Map(cards.map((c) => [c.id, c]));
const questions = new Map(
  parseQuestions(parse(readFileSync(path.join(ROOT, "evals/resourcus/questions.yaml"), "utf8"))).map((q) => [q.id, q]),
);

interface Recorded {
  model: string;
  results: QuestionResult[];
}

// Live runs only: the offline stand-ins never wrote a model answer worth
// replaying.
const runs: Recorded[] = readdirSync(RESULTS)
  .filter((f) => /^\d{4}-\d{2}-\d{2}-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(path.join(RESULTS, f), "utf8")) as Recorded);

// Scores one recorded run as it was, and again as the guard would have left it.
function rescore(run: Recorded, guarded: boolean): { summary: Summary; rejected: string[] } {
  const rejected: string[] = [];
  const results = run.results.map((r) => {
    const q = questions.get(r.id);
    if (!q) throw new Error(`${run.model}: ${r.id} is not in questions.yaml`);
    let { answer, mode, reason, step, cited } = r;
    if (guarded && r.mode === "model") {
      const verdict = checkGrounding({
        answer: r.answer,
        cited: r.cited,
        retrieved: r.retrieved.map((id) => byId.get(id)).filter((c): c is ResourceCard => !!c),
        asked: [r.question],
      });
      if (!verdict.grounded) {
        rejected.push(r.id);
        [answer, mode, reason, step, cited] = [FALLBACK_INTRO, "fallback", "unsafe", "ungrounded", []];
      }
    }
    return scoreOne(
      q,
      { kind: r.kind, ids: r.expected },
      { retrieved: r.retrieved, cited, dropped: r.dropped, raw: r.raw, answer, mode, reason, step, latencyMs: r.latencyMs },
      cards,
    );
  });
  return { summary: summarize(run.model, results), rejected };
}

const SCORED = [
  "citationPrecision",
  "hitRate",
  "falseRefusalRate",
  "refusalAccuracy",
  "noMatchAccuracy",
  "groundedness",
  "leaks",
] as const;

describe("the guard on recorded live answers", () => {
  it("has the three candidate models' runs to read", () => {
    expect(runs.map((r) => r.model).sort()).toEqual([
      "@cf/openai/gpt-oss-20b",
      "@cf/qwen/qwen3-30b-a3b-fp8",
      "@cf/zai-org/glm-4.7-flash",
    ]);
    expect(cards.length).toBeGreaterThan(500);
  });

  it.each(runs.map((r) => [r.model, r] as const))("%s: no scored metric moves", (_model, run) => {
    const before = rescore(run, false).summary;
    const { summary: after, rejected } = rescore(run, true);
    for (const k of SCORED) expect(after[k], k).toBe(before[k]);
    // What the guard did reject: answers that cite nothing and add words of
    // their own. None of them cited a card.
    for (const id of rejected) expect(run.results.find((r) => r.id === id)!.cited, id).toEqual([]);
  });

  it("keeps every answer that cites a retrieved card", () => {
    for (const run of runs) {
      for (const r of run.results.filter((x) => x.mode === "model" && x.cited.length > 0)) {
        const verdict = checkGrounding({
          answer: r.answer,
          cited: r.cited,
          retrieved: r.retrieved.map((id) => byId.get(id)).filter((c): c is ResourceCard => !!c),
          asked: [r.question],
        });
        expect(verdict, `${run.model} ${r.id}`).toEqual({ grounded: true, by: "id" });
      }
    }
  });
});
