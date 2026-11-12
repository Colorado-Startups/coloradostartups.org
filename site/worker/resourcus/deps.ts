// The seams of the Resourcus core. Every outside call (Workers AI, AI Search,
// D1) sits behind one of these interfaces, so tests and the eval harness inject
// fakes and never reach a real model or a real index.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// The slice of the Workers AI binding we use. env.AI satisfies it.
export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

// Writes the answer. One implementation per model family (model.ts).
export interface ModelClient {
  readonly id: string;
  generate(messages: ChatMessage[]): Promise<string>;
}

export interface SafetyVerdict {
  safe: boolean;
  categories: string[];
}

// Screens the visitor's words before anything else runs (guard.ts).
export interface SafetyGuard {
  check(text: string): Promise<SafetyVerdict>;
}

export type UsageCounter = "model_calls" | "search_queries";

// Reserves spend before it happens. False means "do not spend" (budget.ts).
export interface BudgetGate {
  reserve(counter: UsageCounter, n?: number): Promise<boolean>;
}

// Rejects when `ms` passes first, so a hung binding cannot hang a visitor.
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
