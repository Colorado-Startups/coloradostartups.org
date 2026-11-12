// The budget guard. It fails closed: when it cannot prove there is budget
// left, Resourcus does not spend.
//
// Each model call and each AI Search query reserves one unit in D1
// `usage_counters` BEFORE it runs. The reservation is one conditional UPDATE,
// so two concurrent questions cannot both take the last unit, and the counter
// never passes the cap. A question that reaches generation costs two model
// calls (Llama Guard, then the answer) and one search query.
//
// Caps come from RESOURCUS_MONTHLY_MODEL_CAP and RESOURCUS_MONTHLY_SEARCH_CAP
// in wrangler.jsonc, per calendar month in UTC. A missing, empty or malformed
// cap reads as 0, which means no spending.

import { errText } from "../lib/errors";
import type { BudgetGate, UsageCounter } from "./deps";

// The budget period a moment falls in: its UTC month, as YYYY-MM.
export function periodOf(now: Date): string {
  return now.toISOString().slice(0, 7); // YYYY-MM in UTC
}

// Reads one monthly cap. Anything but a whole number reads as 0, which allows
// no spending.
export function parseCap(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return 0;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : 0;
}

export type Caps = Record<UsageCounter, number>;

export class D1Budget implements BudgetGate {
  constructor(
    private readonly db: D1Database | undefined,
    private readonly caps: Caps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(counter: UsageCounter, n = 1): Promise<boolean> {
    const cap = this.caps[counter];
    if (!this.db || cap <= 0 || n <= 0) return false;
    const period = periodOf(this.now());
    try {
      const [, updated] = await this.db.batch<{ count: number }>([
        this.db
          .prepare("INSERT OR IGNORE INTO usage_counters (counter, period, count) VALUES (?1, ?2, 0)")
          .bind(counter, period),
        this.db
          .prepare(
            "UPDATE usage_counters SET count = count + ?3 WHERE counter = ?1 AND period = ?2 AND count + ?3 <= ?4 RETURNING count",
          )
          .bind(counter, period, n, cap),
      ]);
      return (updated?.results?.length ?? 0) > 0;
    } catch (err) {
      console.error("budget reserve failed (refusing spend):", errText(err));
      return false;
    }
  }
}

// The monthly model and search caps from the wrangler.jsonc vars, through
// parseCap.
export function capsFromEnv(env: Pick<Env, "RESOURCUS_MONTHLY_MODEL_CAP" | "RESOURCUS_MONTHLY_SEARCH_CAP">): Caps {
  return {
    model_calls: parseCap(env.RESOURCUS_MONTHLY_MODEL_CAP),
    search_queries: parseCap(env.RESOURCUS_MONTHLY_SEARCH_CAP),
  };
}

// For tests and the eval harness: a gate that always says yes or always no.
export const OPEN_BUDGET: BudgetGate = { reserve: async () => true };
export const CLOSED_BUDGET: BudgetGate = { reserve: async () => false };
