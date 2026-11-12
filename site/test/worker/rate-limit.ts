import wranglerJsonc from "../../wrangler.jsonc?raw";

import { parseJsonc } from "../jsonc.mjs";

// How many calls a test must send to see the local rate limiter refuse one,
// at any clock time (issue #339).
//
// Miniflare's limiter counts in fixed windows aligned to the wall clock
// (`epoch = Math.floor(Date.now() / (period * 1e3))` in miniflare's
// ratelimit-object.worker.ts). A burst that crosses a window edge splits its
// count in two, so `limit + 1` calls can all pass.
//
// A burst of `2 * limit + 1` calls that spans at most two windows puts at
// least `limit + 1` of them in one window, so the limiter refuses at least
// one. That holds while a burst lasts less than one period.
//
// Faking the clock does not help. The limiter is a Durable Object in its own
// Miniflare service, and vi.useFakeTimers changes Date only in the test
// isolate. A probe on 2026-11-02 moved the test's Date forward 60 s and the
// limiter still refused the eleventh call.

type RateLimit = { name: string; simple: { limit: number; period: number } };

// The top-level `ratelimits` in wrangler.jsonc, the one definition the
// Worker's bindings and these tests share (#352). Tests run against the
// top-level bindings, not env.staging.
function limitOf(name: string): number {
  const config = parseJsonc(wranglerJsonc) as { ratelimits?: RateLimit[] };
  const found = config.ratelimits?.find((r) => r.name === name);
  if (!found) throw new Error(`wrangler.jsonc has no ratelimits entry named ${name}`);
  return found.simple.limit;
}

export const FORM_LIMIT = limitOf("FORM_RATE_LIMIT");
export const ASK_LIMIT = limitOf("ASK_RATE_LIMIT");

export function burstOver(limit: number): number {
  return 2 * limit + 1;
}
