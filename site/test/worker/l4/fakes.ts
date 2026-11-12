// Fakes for the two remote-only bindings. Tests never reach Workers AI or AI
// Search: they hand these to the Worker in place of env.AI and
// env.RESOURCUS_SEARCH, so the real LlamaGuard, WorkersAiModel and
// AiSearchRetriever code runs against canned replies.

import type { AiSearchLike } from "../../../worker/resourcus/ai-search";
import type { AiRunner, ChatMessage } from "../../../worker/resourcus/deps";
import { GUARD_MODEL } from "../../../worker/resourcus/guard";

type Reply<T> = T | Error | ((arg: never) => T | Promise<T>);

async function resolve<T>(reply: Reply<T>, arg: unknown): Promise<T> {
  if (reply instanceof Error) throw reply;
  if (typeof reply === "function") return (reply as (a: unknown) => T | Promise<T>)(arg);
  return reply;
}

export interface FakeAiOptions {
  // Raw Llama Guard output. Default: safe.
  guard?: Reply<unknown>;
  // The answer text, wrapped as a chat completion. Default: a cited answer.
  answer?: Reply<string>;
}

export interface FakeAi extends AiRunner {
  calls: { model: string; inputs: Record<string, unknown> }[];
  generations(): { model: string; messages: ChatMessage[] }[];
}

export function fakeAi(opts: FakeAiOptions = {}): FakeAi {
  const calls: FakeAi["calls"] = [];
  return {
    calls,
    generations: () =>
      calls
        .filter((c) => c.model !== GUARD_MODEL)
        .map((c) => ({ model: c.model, messages: c.inputs.messages as ChatMessage[] })),
    async run(model, inputs) {
      calls.push({ model, inputs });
      if (model === GUARD_MODEL) return resolve(opts.guard ?? { response: { safe: true } }, inputs);
      const text = await resolve(opts.answer ?? "Ore Cart Coworking [fx-ore-cart-coworking] has desks in Denver.", inputs);
      return { choices: [{ index: 0, message: { role: "assistant", content: text } }] };
    },
  };
}

export interface FakeSearch extends AiSearchLike {
  calls: unknown[];
}

// Returns one chunk per id, best first.
export function fakeSearch(ids: Reply<string[]>): FakeSearch {
  const calls: unknown[] = [];
  return {
    calls,
    async search(params) {
      calls.push(params);
      const list = await resolve(ids, params);
      return {
        chunks: list.map((id, i) => ({
          score: 0.95 - i * 0.05,
          text: `indexed text for ${id}`,
          item: { key: `${id}.md` },
        })),
      };
    },
  };
}

export const never = <T>(): Promise<T> => new Promise<T>(() => {});

export function limiter(success: boolean) {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success };
    },
  };
}
