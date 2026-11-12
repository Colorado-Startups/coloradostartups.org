// The AI-visibility panel CLI. run.ts calls main() with the real
// environment and fetch; the tests call it with fakes and a temp directory.
//
//   node evals/ai-visibility/run.ts
//       dry run: prints the plan, the estimate and which keys are set. Sends nothing.
//   node evals/ai-visibility/run.ts --live --confirm-spend
//       asks every question of every provider and writes results/.
//   node evals/ai-visibility/run.ts --rescore results/<file>.json
//       re-scores recorded answers with no API calls, after a scorer change.
//
// Flags:
//   --live               call the APIs. Spends money, so it also needs --confirm-spend.
//   --confirm-spend      the person running it has approved the printed estimate.
//   --providers a,b      any of anthropic,openai,perplexity (default: all three).
//   --questions v01,v02  question ids (default: all of questions.yaml).
//   --date YYYY-MM-DD    run date in file names (default: today in Denver). A
//                        label suffix such as 2026-10-18-smoke keeps a test run
//                        apart from the baseline.
//   --overwrite          replace results files that already exist for the date.
//   --write-report       rewrite the results block in REPORT.md.
//   --rescore <file>     re-score one results file; repeat for more.
//
// Keys come only from environment variables (providers.ts keyEnv). The
// runner never prints, logs or writes a key value, and scrubs it from any
// provider error text before that text reaches a results file. On a 401 or
// 403 it records only "HTTP <status>", because a rejection body can echo a
// masked copy of the key (providers.ts makePost).
//
// Exit codes follow the repo's checker contract (CLAUDE.md):
//   0  done (a dry run, a rescore, or a live run where every provider answered)
//   2  usage error, or refused: no --confirm-spend, or results already exist
//   3  could not check: a key is missing, an input will not parse, or a
//      provider answered no question at all

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { costOf, estimate, parsePricing, PROVIDER_IDS, type Pricing, type ProviderId, usd, NO_USAGE } from "./cost.ts";
import {
  type AnswerRecord,
  parseQuestions,
  providerTable,
  type Question,
  rescore,
  type ResultsFile,
  type RunFile,
  scoreAnswer,
  summarize,
  summaryMarkdown,
} from "./panel.ts";
import { isAuthError, makePost, type Post, PROVIDERS } from "./providers.ts";

export interface Deps {
  /** The evals/ai-visibility directory: questions.yaml, pricing.yaml, REPORT.md. */
  root: string;
  /** Where results go. Default: <root>/results. */
  resultsDir?: string;
  /** Default: <root>/REPORT.md. */
  reportFile?: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

interface Args {
  live: boolean;
  confirmSpend: boolean;
  providers: ProviderId[];
  questions: string[] | null;
  date: string | null;
  overwrite: boolean;
  writeReport: boolean;
  rescore: string[];
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    live: false,
    confirmSpend: false,
    providers: [...PROVIDER_IDS],
    questions: null,
    date: null,
    overwrite: false,
    writeReport: false,
    rescore: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    const list = (): string[] =>
      next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (a === "--live") args.live = true;
    else if (a === "--confirm-spend") args.confirmSpend = true;
    else if (a === "--overwrite") args.overwrite = true;
    else if (a === "--write-report") args.writeReport = true;
    else if (a === "--providers") {
      const ids = list();
      const bad = ids.filter((id) => !(PROVIDER_IDS as readonly string[]).includes(id));
      if (bad.length > 0 || ids.length === 0) throw new UsageError(`--providers takes ${PROVIDER_IDS.join(",")}; got ${bad.join(",") || "nothing"}`);
      args.providers = PROVIDER_IDS.filter((id) => ids.includes(id));
    } else if (a === "--questions") {
      args.questions = list();
      if (args.questions.length === 0) throw new UsageError("--questions needs at least one id");
    }
    else if (a === "--date") {
      const d = next();
      if (!/^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(d)) throw new UsageError(`--date takes YYYY-MM-DD or YYYY-MM-DD-label, not ${d}`);
      args.date = d;
    } else if (a === "--rescore") args.rescore.push(next());
    else throw new UsageError(`unknown flag ${a}`);
  }
  if (args.rescore.length > 0 && args.live) throw new UsageError("--rescore makes no API calls; drop --live");
  return args;
}

/** Today's date in Colorado, so an evening run is not filed under tomorrow. */
export function denverDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function scrub(text: string, secret: string): string {
  return secret.length > 0 ? text.split(secret).join("[key redacted]") : text;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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

function reportBlock(date: string, files: readonly RunFile[], estimatedUsd: number | null, summaryPath: string): string {
  return [`Run: ${date}, live. Full summary: \`${summaryPath}\`.`, "", ...providerTable(files, estimatedUsd)].join("\n");
}

function blankRecord(q: Question, error: string): AnswerRecord {
  return {
    id: q.id,
    topic: q.topic,
    region: q.region,
    question: q.question,
    text: "",
    citedUrls: [],
    searchResultUrls: [],
    stopReason: null,
    usage: { ...NO_USAGE },
    costUsd: 0,
    latencyMs: 0,
    error,
    score: null,
  };
}

interface ProviderRun {
  id: ProviderId;
  key: string;
  ceilingUsd: number;
}

async function runProvider(run: ProviderRun, pricing: Pricing, questions: readonly Question[], post: Post, deps: Deps): Promise<AnswerRecord[]> {
  const provider = PROVIDERS[run.id];
  const price = pricing[run.id];
  const out: AnswerRecord[] = [];
  let stop: string | null = null;
  let spent = 0;
  for (const q of questions) {
    if (stop) {
      out.push(blankRecord(q, stop));
      continue;
    }
    const t0 = performance.now();
    try {
      const answer = await provider.ask(q.question, price.model, run.key, post);
      const costUsd = costOf(price, answer.usage);
      spent += costUsd;
      const score = scoreAnswer(answer.text, answer.citedUrls);
      out.push({
        id: q.id,
        topic: q.topic,
        region: q.region,
        question: q.question,
        ...answer,
        costUsd,
        latencyMs: Math.round(performance.now() - t0),
        error: null,
        score,
      });
      const verdict = [score.named ? `named #${score.position?.rank}` : "not named", score.cited ? "cited" : "not cited"].join(", ");
      deps.log(`  ${run.id} ${q.id}: ${verdict}`);
      if (spent > run.ceilingUsd) {
        stop = `skipped: ${run.id} spend reached ${usd(spent)}, past twice its estimate (${usd(run.ceilingUsd)})`;
        deps.log(`  ${stop}`);
      }
    } catch (err) {
      const msg = scrub(errorText(err), run.key);
      out.push({ ...blankRecord(q, msg), latencyMs: Math.round(performance.now() - t0) });
      deps.log(`  ${run.id} ${q.id}: error ${msg.slice(0, 120)}`);
      if (isAuthError(err)) {
        stop = `skipped: the provider rejected ${PROVIDERS[run.id].keyEnv}`;
        deps.log(`  ${stop}`);
      }
    }
  }
  return out;
}

function loadInputs(root: string): { questions: Question[]; pricing: Pricing } {
  const questions = parseQuestions(parse(readFileSync(path.join(root, "questions.yaml"), "utf8")));
  const pricing = parsePricing(parse(readFileSync(path.join(root, "pricing.yaml"), "utf8")));
  return { questions, pricing };
}

function rel(root: string, file: string): string {
  // Paths in reports read from the repo root: evals/ai-visibility/...
  const inside = path.relative(root, file);
  return inside.startsWith("..") || path.isAbsolute(inside) ? file : path.join("evals/ai-visibility", inside);
}

function doRescore(args: Args, deps: Deps, resultsDir: string): number {
  const byDate = new Map<string, RunFile[]>();
  for (const f of args.rescore) {
    const file = path.resolve(f);
    let results: ResultsFile;
    try {
      results = JSON.parse(readFileSync(file, "utf8")) as ResultsFile;
      if (results.panel !== "ai-visibility" || !PROVIDER_IDS.includes(results.provider)) throw new Error("not an ai-visibility results file");
    } catch (err) {
      deps.log(`Could not check: ${f}: ${errorText(err)}`);
      return 3;
    }
    const next = rescore(results);
    writeJson(file, next);
    deps.log(`rescored ${f}: named ${next.summary.named}/${next.summary.questions}, cited ${next.summary.cited}/${next.summary.questions}`);
    const list = byDate.get(next.date) ?? [];
    list.push({ path: rel(deps.root, file), results: next });
    byDate.set(next.date, list);
  }
  for (const [date, files] of byDate) {
    files.sort((a, b) => PROVIDER_IDS.indexOf(a.results.provider) - PROVIDER_IDS.indexOf(b.results.provider));
    const summaryFile = path.join(resultsDir, `${date}-summary.md`);
    writeFileSync(summaryFile, summaryMarkdown(date, files, null));
    deps.log(`wrote ${rel(deps.root, summaryFile)}`);
  }
  return 0;
}

export async function main(argv: readonly string[], deps: Deps): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    deps.log(`Usage error: ${errorText(err)}. See the header of evals/ai-visibility/cli.ts.`);
    return 2;
  }

  let inputs: { questions: Question[]; pricing: Pricing };
  try {
    inputs = loadInputs(deps.root);
  } catch (err) {
    deps.log(`Could not check: questions.yaml or pricing.yaml did not load: ${errorText(err)}`);
    return 3;
  }
  const { pricing } = inputs;
  const resultsDir = deps.resultsDir ?? path.join(deps.root, "results");
  const reportFile = deps.reportFile ?? path.join(deps.root, "REPORT.md");

  if (args.rescore.length > 0) return doRescore(args, deps, resultsDir);

  let questions = inputs.questions;
  if (args.questions) {
    const known = new Set(questions.map((q) => q.id));
    const unknown = args.questions.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      deps.log(`Usage error: unknown question ids ${unknown.join(",")}.`);
      return 2;
    }
    const wanted = new Set(args.questions);
    questions = questions.filter((q) => wanted.has(q.id));
  }

  // ---- the plan, printed before anything can spend ----
  const estimates = estimate(pricing, args.providers, questions.length);
  const total = estimates.reduce((n, e) => n + e.total, 0);
  deps.log(`AI-visibility panel: ${questions.length} questions, ${args.providers.length} providers (${args.providers.join(", ")}).`);
  for (const e of estimates) {
    const keyEnv = PROVIDERS[e.provider].keyEnv;
    const keySet = (deps.env[keyEnv] ?? "").trim().length > 0;
    deps.log(
      `  ${e.provider.padEnd(10)} ${e.model.padEnd(18)} estimate ${usd(e.total)} ($${e.perQuestion.toFixed(3)} a question)  ${keyEnv} ${keySet ? "is set" : "is NOT set"}`,
    );
    deps.log(`  ${"".padEnd(10)} prices from ${e.source}, read ${e.read}`);
  }
  deps.log(`Estimated total: ${usd(total)} for ${questions.length * args.providers.length} answers.`);
  deps.log("The estimate takes each published price and the per-question token and search counts in pricing.yaml `assume`.");
  deps.log("Those counts are assumptions, not measurements; a live run reports the real cost from each provider's usage block.");

  if (!args.live) {
    deps.log("Dry run: nothing was sent. A live run needs --live --confirm-spend, and spends real money.");
    return 0;
  }
  if (!args.confirmSpend) {
    deps.log("Refused: a live run spends money. Nothing was sent.");
    deps.log("Get a yes on the estimate above, then re-run with --live --confirm-spend.");
    return 2;
  }

  const missing = args.providers.map((id) => PROVIDERS[id].keyEnv).filter((name) => (deps.env[name] ?? "").trim().length === 0);
  if (missing.length > 0) {
    deps.log(`Could not check: ${missing.join(", ")} not set in the environment. Nothing was sent.`);
    deps.log("Set the missing keys, or pick providers that have keys with --providers.");
    return 3;
  }

  const date = args.date ?? denverDate(deps.now());
  mkdirSync(resultsDir, { recursive: true });
  const fileFor = (id: ProviderId) => path.join(resultsDir, `${date}-${id}.json`);
  const existing = args.providers.map(fileFor).filter((f) => existsSync(f));
  if (existing.length > 0 && !args.overwrite) {
    deps.log(`Refused: results for ${date} already exist (${existing.map((f) => path.basename(f)).join(", ")}). Nothing was sent.`);
    deps.log("Pass --overwrite to replace them, or --date to file this run under another date.");
    return 2;
  }

  // ---- the live run: providers in parallel, questions in order ----
  const post = makePost({ fetch: deps.fetch, sleep: deps.sleep, timeoutMs: 300_000, retries: 2 });
  const startedAt = deps.now().toISOString();
  deps.log(`Live run ${date}: asking ${questions.length} questions of ${args.providers.join(", ")}.`);
  const runs = await Promise.all(
    estimates.map(async (e) => {
      const key = (deps.env[PROVIDERS[e.provider].keyEnv] ?? "").trim();
      const answers = await runProvider({ id: e.provider, key, ceilingUsd: 2 * e.total }, pricing, questions, post, deps);
      const results: ResultsFile = {
        panel: "ai-visibility",
        version: 1,
        date,
        provider: e.provider,
        model: e.model,
        startedAt,
        finishedAt: deps.now().toISOString(),
        pricing: { source: e.source, read: e.read },
        summary: summarize(e.provider, e.model, answers),
        answers,
      };
      const file = fileFor(e.provider);
      writeJson(file, results);
      deps.log(`wrote ${rel(deps.root, file)}`);
      return { path: rel(deps.root, file), results };
    }),
  );

  const summaryFile = path.join(resultsDir, `${date}-summary.md`);
  writeFileSync(summaryFile, summaryMarkdown(date, runs, total));
  deps.log(`wrote ${rel(deps.root, summaryFile)}`);
  for (const line of providerTable(runs, total)) deps.log(line);
  if (args.writeReport) {
    rewriteReport(reportFile, reportBlock(date, runs, total, rel(deps.root, summaryFile)));
    deps.log("REPORT.md results block rewritten");
  }

  const silent = runs.filter((r) => r.results.summary.answered === 0).map((r) => r.results.provider);
  if (silent.length > 0) {
    deps.log(`Could not check: ${silent.join(", ")} answered no question. See the error field in each results file.`);
    return 3;
  }
  return 0;
}
