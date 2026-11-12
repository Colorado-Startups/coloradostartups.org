// POST /api/ask: the public web door to Resourcus. Owner: L4.
//
// Order of checks, cheapest and least trusting first:
//   1. per-IP rate limit (ASK_RATE_LIMIT), before the body is read      429
//   2. JSON (ASK_MAX_BYTES cap) and AskRequestSchema                     400
//   3. per-session rate limit (same binding, key sess:<sha256>)          429
//      then Turnstile once per session (worker/resourcus/session.ts)    403
//   4. the shared core, answerQuestion(), which runs Llama Guard, the
//      budget guard, retrieval, the model and ask_logs
//
// The body is AskResponse on 200 and { error } otherwise. Answers do not
// stream: the server filters citations and strips links over the whole
// answer before anyone sees a word of it.

import { AskRequestSchema } from "@cs/shared";

import { json, readBodyCapped } from "../lib/forms";
import { isRateLimited, webKey } from "../lib/ratelimit";
import { verifyTurnstile } from "../lib/turnstile";
import { answerQuestion } from "../resourcus/answer";
import { isSessionVerified, isUsableSessionId, markSessionVerified, sha256Hex } from "../resourcus/session";

const PATH = "/api/ask";

// Largest JSON body accepted, counted in bytes actually received (the same
// reason as readFormCapped in lib/forms.ts: a chunked body has no
// Content-Length). AskRequestSchema allows about 8,000 characters of text;
// this leaves room for multi-byte characters and JSON escaping.
const ASK_MAX_BYTES = 32 * 1024;

// Throws for an oversized body, an upload that broke off, or bad JSON. The
// handler answers each one with 400.
async function readJsonCapped(request: Request, max = ASK_MAX_BYTES): Promise<unknown> {
  const bytes = await readBodyCapped(request, max);
  if (!bytes) throw new Error("too large or unreadable");
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Answers one question: AskResponse on 200, or { error } with a status from
// the list above.
export async function handle(request: Request, env: Env): Promise<Response> {
  if (await isRateLimited(env.ASK_RATE_LIMIT, webKey(request, PATH))) {
    return json({ error: "rate-limit" }, 429, { "Retry-After": "60" });
  }

  let body: unknown;
  try {
    body = await readJsonCapped(request);
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const { question, history, filters, sessionId, turnstileToken } = parsed.data;

  const usableSession = isUsableSessionId(sessionId);
  // A second limit per session, so one Turnstile pass shared across many IPs
  // still gets only one session's budget. Keyed by a hash; no IP is stored.
  if (usableSession && (await isRateLimited(env.ASK_RATE_LIMIT, `sess:${await sha256Hex(sessionId)}`))) {
    return json({ error: "rate-limit" }, 429, { "Retry-After": "60" });
  }
  if (!(usableSession && (await isSessionVerified(env.DB, sessionId)))) {
    const ip = request.headers.get("CF-Connecting-IP");
    if (!turnstileToken || !(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip))) {
      return json({ error: "verification" }, 403);
    }
    if (usableSession) await markSessionVerified(env.DB, sessionId);
  }

  const answer = await answerQuestion(env, {
    question,
    history,
    filters,
    caller: "web",
    callerKey: usableSession ? sessionId : undefined,
  });
  return json(answer);
}
