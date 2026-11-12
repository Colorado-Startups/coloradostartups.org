// The generation model, behind ModelClient. One constant picks the model the
// site runs; evals/resourcus/REPORT.md is where that choice is argued, and a
// change to RESOURCUS_MODEL ships by PR like any other.

import type { AiRunner, ChatMessage, ModelClient } from "./deps";
import { stripReasoning } from "./output";

// The three open models the eval compares (PLAN.md, Resourcus, Model choice).
export const CANDIDATE_MODELS = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-20b",
] as const;
export type CandidateModel = (typeof CANDIDATE_MODELS)[number];

// Picked by the first live eval on the real Canvas (2026-10-08): fewest false
// refusals, best hit rate, full groundedness, fastest. evals/resourcus/REPORT.md
// has the numbers and the reasons.
export const RESOURCUS_MODEL: CandidateModel = "@cf/qwen/qwen3-30b-a3b-fp8";

const MAX_OUTPUT_TOKENS = 400;
const TEMPERATURE = 0.2;

// All three accept chat `messages` on Workers AI (worker-configuration.d.ts).
// Each one reasons by default, which spends tokens before the answer, so each
// profile turns reasoning down in that model's own terms. These options are
// checked in the live eval run; a model that rejects one shows up there as an
// error rate, not as a silent wrong answer.
interface Profile {
  extra: Record<string, unknown>;
  systemSuffix: string;
}

const PROFILES: Record<CandidateModel, Profile> = {
  // ChatCompletionsInput: chat_template_kwargs.enable_thinking (default on).
  "@cf/zai-org/glm-4.7-flash": { extra: { chat_template_kwargs: { enable_thinking: false } }, systemSuffix: "" },
  // Qwen3's documented soft switch is "/no_think" in the prompt.
  "@cf/qwen/qwen3-30b-a3b-fp8": { extra: {}, systemSuffix: "\n/no_think" },
  // ChatCompletionsMessagesInput: reasoning_effort.
  "@cf/openai/gpt-oss-20b": { extra: { reasoning_effort: "low" }, systemSuffix: "" },
};

function isCandidateModel(id: string): id is CandidateModel {
  return (CANDIDATE_MODELS as readonly string[]).includes(id);
}

// The Workers AI input for one model: the messages, plus a candidate model's
// system-prompt suffix and extra settings, at our token cap and temperature.
export function modelInputs(model: string, messages: ChatMessage[]): Record<string, unknown> {
  const profile = isCandidateModel(model) ? PROFILES[model] : { extra: {}, systemSuffix: "" };
  const shaped = messages.map((m) =>
    m.role === "system" && profile.systemSuffix ? { ...m, content: m.content + profile.systemSuffix } : m,
  );
  return { messages: shaped, max_tokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE, ...profile.extra };
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object";

// Reads the answer text from any of the shapes these models return:
// chat completions (choices[0].message.content), the Responses API
// (output_text, or output[] message items), or the legacy { response }.
// Reasoning text is never returned: reasoning_content is ignored and <think>
// blocks are cut.
export function extractText(result: unknown): string {
  if (typeof result === "string") return stripReasoning(result).trim();
  if (!isObj(result)) return "";
  const text = chatText(result) ?? outputText(result) ?? outputItemsText(result.output) ?? legacyText(result);
  return text === undefined ? "" : stripReasoning(text).trim();
}

/** Chat completions: choices[0].message.content when it is a string, empty included. */
function chatText(result: Loose): string | undefined {
  const choices = result.choices;
  if (!Array.isArray(choices) || !isObj(choices[0]) || !isObj(choices[0].message)) return undefined;
  const content = choices[0].message.content;
  return typeof content === "string" ? content : undefined;
}

/** The Responses API's output_text, when it holds more than whitespace. */
function outputText(result: Loose): string | undefined {
  return typeof result.output_text === "string" && result.output_text.trim() ? result.output_text : undefined;
}

/** The Responses API's output[]: the first message item whose output_text parts hold more than whitespace. */
function outputItemsText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (!isObj(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    const text = item.content
      .filter((c): c is Loose => isObj(c) && c.type === "output_text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
    if (text.trim()) return text;
  }
  return undefined;
}

/** The legacy { response } shape. */
function legacyText(result: Loose): string | undefined {
  return typeof result.response === "string" ? result.response : undefined;
}

export class WorkersAiModel implements ModelClient {
  constructor(
    private readonly ai: AiRunner,
    readonly id: string = RESOURCUS_MODEL,
  ) {}

  async generate(messages: ChatMessage[]): Promise<string> {
    return extractText(await this.ai.run(this.id, modelInputs(this.id, messages)));
  }
}
