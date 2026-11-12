// The Resourcus core both callers share: POST /api/ask (web) and
// ResourcusRPC.ask() (Slack). One implementation, two doors.
//
// The pipeline, in order. Every step that can fail falls back to an answer
// built from our own data with no model involved, so a failure never reaches
// the visitor as an error and never spends past the budget.
//
//   1. budget: reserve one model call for the guard     else keyword, "budget"
//   2. Llama Guard 3 on the visitor's words              error: keyword, "error"
//                                                        unsafe: refusal, "unsafe"
//   3. budget: reserve one search query                  else keyword, "budget"
//   4. AI Search hybrid retrieval, then our filters      error: keyword, "error"
//                                                        nothing: keyword, "no-match"
//   5. budget: reserve one model call for the answer     else retrieved cards, "budget"
//   6. generation with records marked as data            error: retrieved cards, "error"
//   7. leak check, citation filter, output cleanup       leak: refusal, "unsafe"
//   8. grounding in the cards step 4 returned            ungrounded: retrieved cards, "unsafe"
//
// Cards always come from /data/resources.json (our data). The answer cites
// only ids that step 4 returned and that exist in our cards. Step 8 shows
// model text only when it cites or names one of those cards, or is a fixed
// reply, and repeats no code the visitor planted (grounding.ts).

import {
  ASK_LIMITS,
  RESOURCES_JSON_PATH,
  ResourceCardSchema,
  type AskResponse,
  type ResourceCard,
  type ResourceFilters,
} from "@cs/shared";
import * as z from "zod";

import { errText } from "../lib/errors";
import { AiSearchRetriever, type AiSearchLike } from "./ai-search";
import { capsFromEnv, D1Budget } from "./budget";
import { withTimeout, type AiRunner, type BudgetGate, type ModelClient, type SafetyGuard } from "./deps";
import { FIXTURE_CARDS } from "./fixture";
import { checkGrounding } from "./grounding";
import { isBlocking, LlamaGuard } from "./guard";
import { recordAsk } from "./logs";
import { WorkersAiModel } from "./model";
import { containsLeak, extractCitations, sanitizeAnswer } from "./output";
import { buildMessages, FALLBACK_INTRO, NO_CARDS_REPLY, NO_MATCH_REPLY, OUT_OF_SCOPE_REPLY } from "./prompt";
import { cardText, KeywordRetriever, matchesFilters, type RetrievedResource, type Retriever } from "./retriever";

export interface AnswerInput {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  filters: ResourceFilters;
  caller: "web" | "slack";
  callerKey?: string;
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

// Milliseconds before a binding call counts as failed.
const TIMEOUTS = { guard: 8_000, search: 8_000, model: 25_000 } as const;
// Resources fetched from AI Search, and the most sent to the model.
const RETRIEVE_LIMIT = 12;
const PROMPT_RECORDS = 6;
// Earlier user questions kept as context for a follow-up.
const EARLIER_QUESTIONS = 2;
// resources.json's shape, built once per isolate rather than per question.
const CARD_LIST = z.array(ResourceCardSchema);

// Read the build-time card list through the ASSETS binding. When the file is
// missing, empty or malformed, production gets no cards at all: the fictional
// fixture is used only where RESOURCUS_ALLOW_FIXTURE is "1", which only
// vitest.config.ts sets (decision 38).
export async function loadCards(
  assets: AssetsBinding | undefined,
  allowFixture = false,
): Promise<readonly ResourceCard[]> {
  const fallback = allowFixture ? FIXTURE_CARDS : [];
  if (!assets) return fallback;
  try {
    const res = await assets.fetch(new Request(`https://assets.invalid${RESOURCES_JSON_PATH}`));
    if (!res.ok) return fallback;
    const parsed = CARD_LIST.safeParse(await res.json());
    return parsed.success && parsed.data.length > 0 ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

// True only where RESOURCUS_ALLOW_FIXTURE is "1" (vitest.config.ts), so
// production never answers from the fictional cards.
export const allowFixture = (env: Pick<Env, "RESOURCUS_ALLOW_FIXTURE">) => env.RESOURCUS_ALLOW_FIXTURE === "1";

// Ids to our own cards: unknown ids are dropped, and at most maxCitations stay.
function cardsFor(ids: readonly string[], byId: ReadonlyMap<string, ResourceCard>): ResourceCard[] {
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is ResourceCard => !!c)
    .slice(0, ASK_LIMITS.maxCitations);
}

// Answers from our own cards with no model: a keyword search over them, then a
// fixed intro and the matches. `reason` says why the model was skipped.
export async function keywordFallback(
  cards: readonly ResourceCard[],
  input: Pick<AnswerInput, "question" | "filters">,
  reason: AskResponse["reason"],
): Promise<AskResponse> {
  if (cards.length === 0) {
    return { answer: NO_CARDS_REPLY, citations: [], resources: [], mode: "fallback", reason: "no-match" };
  }
  const hits = await new KeywordRetriever(cards).search(input.question, {
    filters: input.filters,
    limit: ASK_LIMITS.maxCitations,
  });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const resources = cardsFor(hits.map((h) => h.id), byId);
  if (resources.length === 0) {
    return {
      answer: NO_MATCH_REPLY,
      citations: [],
      resources: [],
      mode: "fallback",
      reason: reason === "ok" ? "no-match" : reason,
    };
  }
  return { answer: FALLBACK_INTRO, citations: resources.map((r) => r.id), resources, mode: "fallback", reason };
}

// Cards for resources retrieval already found, when the model cannot run.
function retrievalFallback(
  hits: readonly RetrievedResource[],
  byId: ReadonlyMap<string, ResourceCard>,
  reason: AskResponse["reason"],
): AskResponse {
  const resources = cardsFor(hits.map((h) => h.id), byId);
  return { answer: FALLBACK_INTRO, citations: resources.map((r) => r.id), resources, mode: "fallback", reason };
}

function refusal(): AskResponse {
  return { answer: OUT_OF_SCOPE_REPLY, citations: [], resources: [], mode: "fallback", reason: "unsafe" };
}

export interface AnswerDeps {
  cards: readonly ResourceCard[];
  guard: SafetyGuard | null;
  retriever: Retriever | null;
  model: ModelClient | null;
  budget: BudgetGate;
  // Tests shorten these; production uses TIMEOUTS.
  timeouts?: Partial<Record<keyof typeof TIMEOUTS, number>>;
}

// What happened inside one answer. ask_logs keeps `model` and `dropped`; the
// eval harness scores the rest.
interface AnswerTrace {
  step: "no-cards" | "no-model" | "budget" | "guard-error" | "unsafe" | "search-error" | "no-match" | "model-error" | "leak" | "empty" | "ungrounded" | "answered";
  model: string | null;
  guardCategories: string[];
  retrieved: string[];
  raw: string;
  cited: string[];
  dropped: string[];
}

export interface AnswerResult {
  response: AskResponse;
  trace: AnswerTrace;
}

// The visitor's last few questions, newest last, within the history cap.
function earlierQuestions(history: AnswerInput["history"]): string[] {
  const asked = history.filter((t) => t.role === "user").map((t) => t.content.trim()).filter(Boolean);
  const kept: string[] = [];
  let total = 0;
  for (const q of asked.slice(-EARLIER_QUESTIONS).reverse()) {
    total += q.length;
    if (total > ASK_LIMITS.maxHistoryChars) break;
    kept.unshift(q);
  }
  return kept;
}

// Runs steps 1 to 8 above and returns the answer with a trace of each step.
// answerQuestion() adds the real bindings and ask_logs; the eval harness calls
// this directly.
export async function runPipeline(deps: AnswerDeps, input: AnswerInput): Promise<AnswerResult> {
  const trace: AnswerTrace = {
    step: "answered",
    model: null,
    guardCategories: [],
    retrieved: [],
    raw: "",
    cited: [],
    dropped: [],
  };
  const done = (response: AskResponse, step: AnswerTrace["step"]): AnswerResult => {
    trace.step = step;
    return { response, trace };
  };
  const keyword = async (reason: AskResponse["reason"], step: AnswerTrace["step"]) =>
    done(await keywordFallback(deps.cards, input, reason), step);

  const { guard, retriever, model, budget } = deps;
  const limits = { ...TIMEOUTS, ...deps.timeouts };
  // No published cards: nothing to cite, so spend nothing.
  if (deps.cards.length === 0) return keyword("no-match", "no-cards");
  if (!guard || !retriever || !model) return keyword("ok", "no-model");

  const earlier = earlierQuestions(input.history);

  // 1 and 2: the guard reads everything the visitor wrote this session.
  if (!(await budget.reserve("model_calls"))) return keyword("budget", "budget");
  try {
    const verdict = await withTimeout(guard.check([...earlier, input.question].join("\n\n")), limits.guard, "guard");
    trace.guardCategories = verdict.categories;
    if (isBlocking(verdict)) return done(refusal(), "unsafe");
  } catch (err) {
    console.error("resourcus guard failed (keyword fallback):", errText(err));
    return keyword("error", "guard-error");
  }

  // 3 and 4: retrieval, then our own filters over our own cards.
  if (!(await budget.reserve("search_queries"))) return keyword("budget", "budget");
  const byId = new Map(deps.cards.map((c) => [c.id, c]));
  let hits: RetrievedResource[];
  try {
    const query = [...earlier.slice(-1), input.question].join(" ");
    const raw = await withTimeout(
      retriever.search(query, { filters: input.filters, limit: RETRIEVE_LIMIT }),
      limits.search,
      "search",
    );
    hits = raw
      .filter((h) => {
        const card = byId.get(h.id);
        return !!card && matchesFilters(card, input.filters);
      })
      .slice(0, PROMPT_RECORDS)
      // The model reads our card text, not whatever the index chunked.
      .map((h) => ({ ...h, text: cardText(byId.get(h.id)!) }));
  } catch (err) {
    console.error("resourcus search failed (keyword fallback):", errText(err));
    return keyword("error", "search-error");
  }
  trace.retrieved = hits.map((h) => h.id);
  if (hits.length === 0) return keyword("no-match", "no-match");

  // 5 and 6: generation.
  if (!(await budget.reserve("model_calls"))) return done(retrievalFallback(hits, byId, "budget"), "budget");
  trace.model = model.id;
  try {
    trace.raw = await withTimeout(
      model.generate(buildMessages({ question: input.question, earlierQuestions: earlier, hits })),
      limits.model,
      "model",
    );
  } catch (err) {
    console.error("resourcus model failed (retrieval fallback):", errText(err));
    return done(retrievalFallback(hits, byId, "error"), "model-error");
  }

  // 7: nothing the model wrote is trusted.
  if (containsLeak(trace.raw)) return done(refusal(), "leak");
  const { text, cited, dropped } = extractCitations(trace.raw, new Set(trace.retrieved));
  trace.cited = cited;
  trace.dropped = dropped;
  const answer = sanitizeAnswer(text);
  // Again after cleanup: stripping markup can rebuild a marker it hid.
  if (containsLeak(answer)) return done(refusal(), "leak");
  if (!answer) return done(retrievalFallback(hits, byId, "error"), "empty");

  // 8: shown only when grounded in what step 4 returned. The reason stays
  // "unsafe" because AskResponseSchema (packages/shared) has no "ungrounded";
  // the trace step tells the two apart.
  const grounding = checkGrounding({
    answer,
    cited,
    retrieved: hits.map((h) => byId.get(h.id)!),
    asked: [...earlier, input.question],
  });
  if (!grounding.grounded) {
    console.warn(`resourcus answer ungrounded (${grounding.why}); showing the retrieved cards`);
    return done(retrievalFallback(hits, byId, "unsafe"), "ungrounded");
  }
  const resources = cardsFor(cited, byId);
  return done(
    { answer, citations: resources.map((r) => r.id), resources, mode: "model", reason: "ok" },
    "answered",
  );
}

// The real bindings, wrapped in the interfaces the pipeline expects.
export function depsFromEnv(env: Env, cards: readonly ResourceCard[]): AnswerDeps {
  const ai = env.AI as unknown as AiRunner | undefined;
  const search = env.RESOURCUS_SEARCH as unknown as AiSearchLike | undefined;
  return {
    cards,
    guard: ai ? new LlamaGuard(ai) : null,
    model: ai ? new WorkersAiModel(ai) : null,
    retriever: search ? new AiSearchRetriever(search) : null,
    budget: new D1Budget(env.DB, capsFromEnv(env)),
  };
}

// `overrides` exists for tests: they swap any dependency for a fake.
export async function answerQuestion(
  env: Env,
  input: AnswerInput,
  overrides: Partial<AnswerDeps> = {},
): Promise<AskResponse> {
  const cards = overrides.cards ?? (await loadCards(env.ASSETS, allowFixture(env)));
  const { response, trace } = await runPipeline({ ...depsFromEnv(env, cards), ...overrides }, input);
  await recordAsk(env.DB, {
    caller: input.caller,
    callerKey: input.callerKey,
    question: input.question,
    response,
    model: trace.model,
    dropped: trace.dropped,
  });
  return response;
}
