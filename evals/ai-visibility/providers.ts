// The three assistants the panel asks, each with live web search on.
//
// One adapter per API. Each builds its request, posts it through an injected
// Post, and pulls out the answer text, the URLs the answer cites, the URLs
// its searches returned, and the usage block the provider bills on.
//
// Plain fetch, not each vendor's SDK: the repo installs neither SDK, and one
// small HTTP layer lets the tests replay recorded responses for all three.
// Request shapes come from each provider's docs, read 2026-10-18:
//   Anthropic   platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
//   OpenAI      developers.openai.com/api/docs/guides/tools-web-search
//   Perplexity  docs.perplexity.ai/api-reference/chat-completions-post
//
// Every request sends the question alone, with no system prompt and no user
// location, so all three answer the same words the way a person typed them.

import { type ContextSize, NO_USAGE, type ProviderId, type Usage } from "./cost.ts";

export interface Answer {
  text: string;
  citedUrls: string[];
  searchResultUrls: string[];
  stopReason: string | null;
  usage: Usage;
}

export type Post = (url: string, headers: Record<string, string>, body: unknown) => Promise<unknown>;

export interface Provider {
  id: ProviderId;
  label: string;
  /** The environment variable the key comes from. The runner reads nothing else. */
  keyEnv: string;
  ask(question: string, model: string, key: string, post: Post): Promise<Answer>;
}

// ---------- HTTP ----------

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** The statuses that mean the provider rejected the key. */
function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/** A rejected key: stop asking that provider. */
export function isAuthError(err: unknown): boolean {
  return err instanceof HttpError && isAuthStatus(err.status);
}

export interface PostOptions {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  /** Extra attempts after a 429, a 5xx or a network failure. */
  retries: number;
}

function retryAfterMs(res: Response): number | null {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 60) * 1000 : null;
}

export function makePost(o: PostOptions): Post {
  return async (url, headers, body) => {
    for (let attempt = 0; ; attempt++) {
      const backoff = 2000 * 2 ** attempt;
      let res: Response;
      try {
        res = await o.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(o.timeoutMs),
        });
      } catch (err) {
        if (attempt < o.retries) {
          await o.sleep(backoff);
          continue;
        }
        throw new HttpError(0, `request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (res.ok) return (await res.json()) as unknown;
      if (isAuthStatus(res.status)) {
        // Record the status alone and never read the body. OpenAI's 401 body
        // echoes a masked copy of the key, and the key scrub cannot catch a
        // masked copy. Every provider posts through here, so this covers all three.
        await res.body?.cancel().catch(() => {});
        throw new HttpError(res.status, `HTTP ${res.status}`);
      }
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      if ((res.status === 429 || res.status >= 500) && attempt < o.retries) {
        await o.sleep(retryAfterMs(res) ?? backoff);
        continue;
      }
      throw new HttpError(res.status, `HTTP ${res.status}: ${detail}`);
    }
  };
}

// ---------- reading untyped JSON ----------

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function uniq(xs: (string | null)[]): string[] {
  return [...new Set(xs.filter((x): x is string => x !== null && x.length > 0))];
}

// ---------- Anthropic ----------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// web_search_20260209 is the dynamic-filtering version for Sonnet 5.5.
// max_uses caps searches per request; pricing.yaml assumes the cap is hit.
const ANTHROPIC_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 5 };
// A long search turn can return stop_reason pause_turn; the docs say to send
// the paused content back as an assistant turn. Capped like any retry loop.
const ANTHROPIC_MAX_CONTINUATIONS = 3;

/** Reads one or more Messages API responses that together make one turn. */
export function parseAnthropic(responses: readonly unknown[]): Answer {
  const texts: string[] = [];
  const cited: (string | null)[] = [];
  const found: (string | null)[] = [];
  const usage: Usage = { ...NO_USAGE };
  let stopReason: string | null = null;
  for (const raw of responses) {
    const r = rec(raw);
    stopReason = str(r.stop_reason);
    const u = rec(r.usage);
    // The panel sets no cache_control, so the cache token fields stay 0.
    usage.inputTokens += num(u.input_tokens);
    usage.outputTokens += num(u.output_tokens);
    usage.searches += num(rec(u.server_tool_use).web_search_requests);
    usage.requests += 1;
    for (const b of arr(r.content).map(rec)) {
      if (b.type === "text") {
        texts.push(str(b.text) ?? "");
        for (const c of arr(b.citations).map(rec)) cited.push(str(c.url));
      } else if (b.type === "web_search_tool_result") {
        // On an error, content is one object, not a list (docs, "Errors").
        for (const item of arr(b.content).map(rec)) found.push(str(item.url));
      }
    }
  }
  return { text: texts.join(""), citedUrls: uniq(cited), searchResultUrls: uniq(found), stopReason, usage };
}

export const anthropic: Provider = {
  id: "anthropic",
  label: "Anthropic Messages API, web search tool",
  // The key registry row API-Key-Anthropic-AIVisibility (API Keys/keys.toml).
  keyEnv: "ANTHROPIC_API_KEY",
  async ask(question, model, key, post) {
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    const responses: unknown[] = [];
    const turn: unknown[] = [];
    let container: string | null = null;
    for (let i = 0; i <= ANTHROPIC_MAX_CONTINUATIONS; i++) {
      const messages: unknown[] = [{ role: "user", content: question }];
      if (turn.length > 0) messages.push({ role: "assistant", content: turn });
      // No fallbacks parameter: a refusal is a result to record, and a
      // fallback would answer with a different model than the one measured.
      const body: Rec = { model, max_tokens: 16000, messages, tools: [ANTHROPIC_SEARCH_TOOL] };
      if (container) body.container = container;
      const res = rec(await post(ANTHROPIC_URL, headers, body));
      responses.push(res);
      if (res.stop_reason !== "pause_turn") break;
      turn.push(...arr(res.content));
      container = str(rec(res.container).id) ?? container;
    }
    return parseAnthropic(responses);
  },
};

// ---------- OpenAI ----------

const OPENAI_URL = "https://api.openai.com/v1/responses";

export function parseOpenAI(raw: unknown): Answer {
  const r = rec(raw);
  const texts: string[] = [];
  const cited: (string | null)[] = [];
  const found: (string | null)[] = [];
  let searches = 0;
  for (const item of arr(r.output).map(rec)) {
    if (item.type === "web_search_call") {
      const action = rec(item.action);
      if (action.type === "search") searches += 1;
      for (const s of arr(action.sources).map(rec)) found.push(str(s.url));
    } else if (item.type === "message") {
      for (const part of arr(item.content).map(rec)) {
        if (part.type !== "output_text") continue;
        texts.push(str(part.text) ?? "");
        for (const a of arr(part.annotations).map(rec)) {
          if (a.type === "url_citation") cited.push(str(a.url));
        }
      }
    }
  }
  const u = rec(r.usage);
  const status = str(r.status);
  const reason = str(rec(r.incomplete_details).reason);
  return {
    text: texts.join("\n\n"),
    citedUrls: uniq(cited),
    searchResultUrls: uniq(found),
    stopReason: status && reason ? `${status}:${reason}` : status,
    usage: { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens), searches, requests: 1, contextSize: null },
  };
}

export const openai: Provider = {
  id: "openai",
  label: "OpenAI Responses API, web_search tool",
  // The name OpenAI's own tools read. The key registry has no row yet.
  keyEnv: "OPENAI_API_KEY",
  async ask(question, model, key, post) {
    const body = {
      model,
      input: question,
      tools: [{ type: "web_search" }],
      // The full list of URLs the searches consulted, not only the inline citations.
      include: ["web_search_call.action.sources"],
    };
    return parseOpenAI(await post(OPENAI_URL, { authorization: `Bearer ${key}` }, body));
  },
};

// ---------- Perplexity ----------

const PERPLEXITY_URL = "https://api.perplexity.ai/v1/sonar";

function contextSize(v: unknown): ContextSize | null {
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

export function parsePerplexity(raw: unknown): Answer {
  const r = rec(raw);
  const choice = rec(arr(r.choices)[0]);
  const u = rec(r.usage);
  return {
    text: str(rec(choice.message).content) ?? "",
    citedUrls: uniq(arr(r.citations).map(str)),
    searchResultUrls: uniq(arr(r.search_results).map((s) => str(rec(s).url))),
    stopReason: str(choice.finish_reason),
    usage: {
      inputTokens: num(u.prompt_tokens),
      outputTokens: num(u.completion_tokens),
      searches: num(u.num_search_queries),
      requests: 1,
      contextSize: contextSize(u.search_context_size),
    },
  };
}

export const perplexity: Provider = {
  id: "perplexity",
  label: "Perplexity Sonar API",
  // The name Perplexity's docs use in their examples. The key registry has no row yet.
  keyEnv: "PERPLEXITY_API_KEY",
  async ask(question, model, key, post) {
    const body = { model, messages: [{ role: "user", content: question }] };
    return parsePerplexity(await post(PERPLEXITY_URL, { authorization: `Bearer ${key}` }, body));
  },
};

export const PROVIDERS: Record<ProviderId, Provider> = { anthropic, openai, perplexity };
