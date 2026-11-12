// Prices and spend for the AI-visibility panel. pricing.yaml is the one
// place a price or a model id lives; this file reads it and does the math.
// No I/O: cli.ts loads the YAML and passes the parsed object in.

import { z } from "zod";

export const PROVIDER_IDS = ["anthropic", "openai", "perplexity"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

const CONTEXT_SIZES = ["low", "medium", "high"] as const;
export type ContextSize = (typeof CONTEXT_SIZES)[number];

const PriceSchema = z
  .object({
    source: z.url(),
    read: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    model: z.string().min(1),
    input_per_mtok: z.number().nonnegative(),
    output_per_mtok: z.number().nonnegative(),
    search_per_1k: z.number().nonnegative().optional(),
    request_per_1k: z
      .object({ low: z.number().nonnegative(), medium: z.number().nonnegative(), high: z.number().nonnegative() })
      .strict()
      .optional(),
    assume: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        searches: z.number().int().nonnegative(),
        context_size: z.enum(CONTEXT_SIZES).optional(),
      })
      .strict(),
  })
  .strict();
export type Price = z.infer<typeof PriceSchema>;

export const PricingSchema = z.object({ anthropic: PriceSchema, openai: PriceSchema, perplexity: PriceSchema }).strict();
export type Pricing = z.infer<typeof PricingSchema>;

export function parsePricing(raw: unknown): Pricing {
  return PricingSchema.parse(raw);
}

/** What one answer used, as the provider's own usage block reports it. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searches: number;
  requests: number;
  /** Perplexity only; null when the response does not say. */
  contextSize: ContextSize | null;
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, searches: 0, requests: 0, contextSize: null };

/** Dollars for one answer. An unknown Perplexity context size is charged at the high fee. */
export function costOf(price: Price, u: Usage): number {
  const tokens = (u.inputTokens * price.input_per_mtok + u.outputTokens * price.output_per_mtok) / 1_000_000;
  const searches = (u.searches * (price.search_per_1k ?? 0)) / 1000;
  const fee = price.request_per_1k ? (u.requests * price.request_per_1k[u.contextSize ?? "high"]) / 1000 : 0;
  return tokens + searches + fee;
}

/** The assumed usage of one question, from pricing.yaml `assume`. */
export function assumedUsage(price: Price): Usage {
  return {
    inputTokens: price.assume.input_tokens,
    outputTokens: price.assume.output_tokens,
    searches: price.assume.searches,
    requests: 1,
    contextSize: price.assume.context_size ?? null,
  };
}

export interface Estimate {
  provider: ProviderId;
  model: string;
  questions: number;
  perQuestion: number;
  total: number;
  source: string;
  read: string;
}

export function estimate(pricing: Pricing, providers: readonly ProviderId[], questions: number): Estimate[] {
  return providers.map((id) => {
    const price = pricing[id];
    const perQuestion = costOf(price, assumedUsage(price));
    return {
      provider: id,
      model: price.model,
      questions,
      perQuestion,
      total: perQuestion * questions,
      source: price.source,
      read: price.read,
    };
  });
}

export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}
