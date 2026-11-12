// Llama Guard 3 on input. It runs before retrieval, so an unsafe question
// spends neither a search query nor a generation call.
//
// Failing closed: a guard error or an output we cannot read throws, and the
// core answers with the keyword fallback, which involves no model at all.

import type { AiRunner, SafetyGuard, SafetyVerdict } from "./deps";

export const GUARD_MODEL = "@cf/meta/llama-guard-3-8b";

// Llama Guard 3 labels hazards S1 to S14 (Cloudflare docs, AI Gateway
// Guardrails, "Hazard categories"). S6 is "Specialized Advice" (legal,
// financial, medical). Asking where to find a
// startup lawyer or an accountant is the job here, and the system prompt
// already bars giving that advice, so S6 alone does not block. Every other
// code blocks, including S13 (Elections), which CS must never touch.
const NON_BLOCKING_CATEGORIES: ReadonlySet<string> = new Set(["S6"]);

// True when Llama Guard's verdict blocks the question: unsafe with no category,
// or with any category but S6.
export function isBlocking(verdict: SafetyVerdict): boolean {
  if (verdict.safe) return false;
  if (verdict.categories.length === 0) return true;
  return verdict.categories.some((c) => !NON_BLOCKING_CATEGORIES.has(c));
}

function categoriesFrom(text: string): string[] {
  return [...new Set(text.toUpperCase().match(/S\d{1,2}/g) ?? [])];
}

// Workers AI returns either { response: { safe, categories } } or the raw
// model text, "safe" or "unsafe\nS1,S10". Anything else is unreadable: null.
export function parseGuardVerdict(result: unknown): SafetyVerdict | null {
  const response =
    result && typeof result === "object" && "response" in result
      ? (result as { response: unknown }).response
      : result;
  if (response && typeof response === "object") return objectVerdict(response as { safe?: unknown; categories?: unknown });
  return typeof response === "string" ? textVerdict(response) : null;
}

/**
 * { safe, categories }: null unless safe is a boolean; categories keeps only
 * S-codes from strings. A verdict that says safe but lists anything as a
 * category, S-code or not, is not a clean verdict, so it is null too and
 * LlamaGuard.check fails closed (#745).
 */
function objectVerdict(r: { safe?: unknown; categories?: unknown }): SafetyVerdict | null {
  if (typeof r.safe !== "boolean") return null;
  const categories = Array.isArray(r.categories) ? categoriesFrom(r.categories.filter((c) => typeof c === "string").join(",")) : [];
  if (r.safe && Array.isArray(r.categories) && r.categories.length > 0) return null;
  return { safe: r.safe, categories };
}

/**
 * The model's raw text: exactly "safe", or a first line of exactly "unsafe"
 * with its categories on the lines after ("unsafe\nS1,S10"). Anything else,
 * "safely" or "safe\nS1" included, is null, so LlamaGuard.check fails
 * closed (#734).
 */
function textVerdict(response: string): SafetyVerdict | null {
  const text = response.trim().toLowerCase();
  if (text === "safe") return { safe: true, categories: [] };
  const [head, ...rest] = text.split("\n");
  if (head?.trim() === "unsafe") return { safe: false, categories: categoriesFrom(rest.join(",")) };
  return null;
}

export class LlamaGuard implements SafetyGuard {
  constructor(private readonly ai: AiRunner) {}

  async check(text: string): Promise<SafetyVerdict> {
    const result = await this.ai.run(GUARD_MODEL, {
      messages: [{ role: "user", content: text }],
      max_tokens: 32,
      temperature: 0,
    });
    const verdict = parseGuardVerdict(result);
    if (!verdict) throw new Error("unreadable guard verdict");
    return verdict;
  }
}
