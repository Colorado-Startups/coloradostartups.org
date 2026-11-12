// The eval CLI. run.mjs bundles this file with esbuild and runs it in Node.
//
// Offline (the default) needs no network and no Cloudflare login:
//   node evals/resourcus/run.mjs
//     keyword retrieval over the corpus, a safe-saying guard, and two
//     stand-in models (offline:oracle, offline:echo-all) that check the
//     scorer itself.
//
// Live needs `wrangler login` (Paul's Cloudflare account) and spends real
// Workers AI and AI Search units; the orchestrator schedules it:
//   node evals/resourcus/run.mjs --live --write-report
//     reaches env.AI and env.RESOURCUS_SEARCH of the staging Worker through
//     wrangler's getPlatformProxy({ remoteBindings: true }). Retrieval and the
//     Llama Guard verdict are cached per question in cache/, so comparing the
//     three models costs one search and one guard call per question.
//
// Flags:
//   --live                    use the real bindings (default: offline)
//   --models a,b              model ids (default: the three candidates live,
//                             offline:oracle,offline:echo-all offline)
//   --replay <results.json>   score recorded raw outputs again, no model calls
//   --corpus fixture|data|<resources.json>   default: data when
//                             data/resources/ has records, else fixture
//   --env staging|production  wrangler environment for --live (default staging)
//   --write-report            rewrite the results block in REPORT.md
//   --check                   exit 1 when the recommended (or only) live model
//                             misses a goal in THRESHOLDS

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ResourceCardSchema, ResourceSchema, toCard, type ResourceCard } from "@cs/shared";
import { parse } from "yaml";
import { z } from "zod";

import { AiSearchRetriever, type AiSearchLike } from "../../site/worker/resourcus/ai-search";
import type { AiRunner, ModelClient, SafetyGuard } from "../../site/worker/resourcus/deps";
import { FIXTURE_CARDS } from "../../site/worker/resourcus/fixture";
import { LlamaGuard } from "../../site/worker/resourcus/guard";
import { CANDIDATE_MODELS, WorkersAiModel } from "../../site/worker/resourcus/model";
import { KeywordRetriever, type Retriever } from "../../site/worker/resourcus/retriever";
import {
  CachedGuard,
  CachedRetriever,
  corpusHash,
  EchoAllModel,
  emptyCache,
  failedThresholds,
  markdownTable,
  OracleModel,
  parseQuestions,
  recommend,
  ReplayModel,
  resolveExpected,
  runEval,
  SAFE_GUARD,
  summarize,
  THRESHOLDS,
  type CacheFile,
  type QuestionResult,
  type Summary,
} from "./harness";

interface Args {
  live: boolean;
  models: string[] | null;
  replay: string | null;
  corpus: string | null;
  env: string;
  writeReport: boolean;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { live: false, models: null, replay: null, corpus: null, env: "staging", writeReport: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--live") args.live = true;
    else if (a === "--offline") args.live = false;
    else if (a === "--models") args.models = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--replay") args.replay = next();
    else if (a === "--corpus") args.corpus = next();
    else if (a === "--env") args.env = next();
    else if (a === "--write-report") args.writeReport = true;
    else if (a === "--check") args.check = true;
    else throw new Error(`unknown flag ${a}`);
  }
  return args;
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return yamlFiles(p);
    return /\.ya?ml$/.test(name) ? [p] : [];
  });
}

function loadCorpus(root: string, choice: string | null): { cards: ResourceCard[]; label: string } {
  const dataFiles = yamlFiles(path.join(root, "data/resources"));
  const pick = choice ?? (dataFiles.length > 0 ? "data" : "fixture");
  if (pick === "fixture") return { cards: [...FIXTURE_CARDS], label: "fixture (20 fictional cards)" };
  if (pick === "data") {
    const cards = dataFiles
      .map((f) => ResourceSchema.parse(parse(readFileSync(f, "utf8"))))
      .filter((r) => r.status === "active")
      .map(toCard);
    return { cards, label: `data/resources (${cards.length} active)` };
  }
  const cards = z.array(ResourceCardSchema).parse(JSON.parse(readFileSync(path.resolve(root, pick), "utf8")));
  return { cards, label: `${pick} (${cards.length} cards)` };
}

function readCache(file: string, corpus: string, source: string): CacheFile {
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, "utf8")) as CacheFile;
    if (c.corpus === corpus && c.source === source) return c;
    console.log(`cache ${path.basename(file)} is for another corpus or source; starting fresh`);
  }
  return emptyCache(corpus, source);
}

interface LiveBindings {
  ai: AiRunner;
  search: AiSearchLike;
  instance: string;
  dispose(): Promise<void>;
}

async function liveBindings(root: string, env: string): Promise<LiveBindings> {
  const require = createRequire(path.join(root, "package.json"));
  const wrangler = (await import(pathToFileURL(require.resolve("wrangler")).href)) as {
    getPlatformProxy(opts: Record<string, unknown>): Promise<{ env: Record<string, unknown>; dispose(): Promise<void> }>;
  };
  const configPath = path.join(root, "site/wrangler.jsonc");
  const proxy = await wrangler.getPlatformProxy({
    configPath,
    environment: env === "production" ? undefined : env,
    remoteBindings: true,
  });
  const instance = env === "production" ? "resourcus" : `resourcus-${env}`;
  return {
    ai: proxy.env.AI as AiRunner,
    search: proxy.env.RESOURCUS_SEARCH as AiSearchLike,
    instance,
    dispose: () => proxy.dispose(),
  };
}

function rewriteReport(file: string, block: string): void {
  const start = "<!-- results:start -->";
  const end = "<!-- results:end -->";
  const text = readFileSync(file, "utf8");
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`${file} has no results markers`);
  writeFileSync(file, `${text.slice(0, a + start.length)}\n${block}\n${text.slice(b)}`);
}

export async function main(root: string, argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const here = path.join(root, "evals/resourcus");
  const questions = parseQuestions(parse(readFileSync(path.join(here, "questions.yaml"), "utf8")));
  const { cards, label } = loadCorpus(root, args.corpus);
  const corpus = corpusHash(cards);
  const expectedByQuestion = new Map(questions.map((q) => [q.question, resolveExpected(q, cards)]));
  const kinds = [...expectedByQuestion.values()].reduce<Record<string, number>>(
    (acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc),
    {},
  );
  console.log(`Resourcus eval: ${questions.length} questions, corpus ${label} [${corpus}]`);
  console.log(`  kinds on this corpus: ${JSON.stringify(kinds)}`);

  let live: LiveBindings | null = null;
  let retriever: Retriever = new KeywordRetriever(cards);
  let guard: SafetyGuard = SAFE_GUARD;
  let source = "keyword";
  if (args.live) {
    live = await liveBindings(root, args.env);
    retriever = new AiSearchRetriever(live.search);
    guard = new LlamaGuard(live.ai);
    source = live.instance;
  }
  const cacheDir = path.join(here, "cache");
  const cacheFile = path.join(cacheDir, `${source}.json`);
  const cache = readCache(cacheFile, corpus, source);
  const cachedRetriever = new CachedRetriever(retriever, cache);
  const cachedGuard = new CachedGuard(guard, cache);

  let models: ModelClient[];
  if (args.replay) {
    const recorded = JSON.parse(readFileSync(path.resolve(root, args.replay), "utf8")) as {
      model: string;
      results: QuestionResult[];
    };
    models = [new ReplayModel(`replay:${recorded.model}`, new Map(recorded.results.map((r) => [r.question, r.raw])))];
  } else if (args.live) {
    if (!live) throw new Error("live bindings missing");
    const ai = live.ai;
    models = (args.models ?? [...CANDIDATE_MODELS]).map((id) => new WorkersAiModel(ai, id));
  } else {
    const ids = args.models ?? ["offline:oracle", "offline:echo-all"];
    models = ids.map((id) => {
      if (id === "offline:oracle") return new OracleModel((q) => expectedByQuestion.get(q)!);
      if (id === "offline:echo-all") return new EchoAllModel();
      throw new Error(`offline runs take offline:oracle or offline:echo-all, not ${id}`);
    });
  }

  const summaries: Summary[] = [];
  const stamp = new Date().toISOString().slice(0, 10);
  const resultsDir = path.join(here, "results");
  mkdirSync(resultsDir, { recursive: true });
  try {
    for (const model of models) {
      console.log(`\n${model.id}`);
      const results = await runEval({ questions, cards, retriever: cachedRetriever, guard: cachedGuard, model });
      const summary = summarize(model.id, results);
      summaries.push(summary);
      const name = `${args.live ? stamp : "offline"}-${model.id.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
      writeFileSync(
        path.join(resultsDir, name),
        `${JSON.stringify({ model: model.id, corpus: label, corpusHash: corpus, retrieval: source, summary, results }, null, 2)}\n`,
      );
      const misses = failedThresholds(summary);
      console.log(`  ${misses.length === 0 ? "meets every goal" : `misses: ${misses.join("; ")}`}`);
      console.log(`  results/${name}`);
    }
  } finally {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
    console.log(
      args.live
        ? `\nAI Search queries paid this run: ${cachedRetriever.misses}; Llama Guard calls paid: ${cachedGuard.misses}`
        : `\nkeyword lookups this run: ${cachedRetriever.misses} (the rest came from the cache)`,
    );
    await live?.dispose();
  }

  const table = markdownTable(summaries);
  console.log(`\n${table}`);
  const best = recommend(summaries);
  if (args.writeReport) {
    const mode = args.live ? `live, ${source}` : "offline, keyword retrieval";
    const lines = [
      `Run: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, ${mode}, corpus ${label} [${corpus}].`,
      `Kinds on this corpus: ${kinds.answer ?? 0} answerable, ${kinds["no-match"] ?? 0} no-match, ${kinds.refuse ?? 0} should refuse.`,
      "",
      table,
      "",
      best
        ? `Recommended by the harness: \`${best.model}\` (meets every goal; ranked by refusals, then groundedness, precision and speed).`
        : "Recommended by the harness: none yet. No live model has met every goal in this run.",
    ];
    rewriteReport(path.join(here, "REPORT.md"), lines.join("\n"));
    console.log("REPORT.md results block rewritten");
  }

  if (args.check) {
    const target = best ?? summaries.find((s) => !s.model.startsWith("offline:")) ?? summaries[0];
    const misses = target ? failedThresholds(target) : ["no results"];
    if (misses.length > 0) {
      console.error(`check failed for ${target?.model}: ${misses.join("; ")} (goals: ${JSON.stringify(THRESHOLDS)})`);
      return 1;
    }
  }
  return 0;
}
