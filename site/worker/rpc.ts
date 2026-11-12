// ResourcusRPC: the private door for Slack. The Communitas Worker reaches it
// through a service binding with entrypoint "ResourcusRPC". A service binding
// has no public URL, so this path needs no Turnstile; Communitas verifies the
// Slack signature before it ever calls here, and limits per Slack user.
//
// Contract (frozen in Wave 0; changes go through the orchestrator):
//   ask(RpcAskRequest) -> AskResponse, never streams, never throws on bad input
//   (returns a fallback with reason "error" instead).
//
// L4 owns the body of ask(); the class name, method name and types stay.

import { ASK_ERROR_RESPONSE, RpcAskRequestSchema, type AskResponse } from "@cs/shared";
import { WorkerEntrypoint } from "cloudflare:workers";

import { isRateLimited } from "./lib/ratelimit";
import { allowFixture, answerQuestion, keywordFallback, loadCards } from "./resourcus/answer";

export class ResourcusRPC extends WorkerEntrypoint<Env> {
  async ask(raw: unknown): Promise<AskResponse> {
    const parsed = RpcAskRequestSchema.safeParse(raw);
    if (!parsed.success) return ASK_ERROR_RESPONSE;
    const { question, filters, userKey } = parsed.data;
    try {
      // Per Slack user, on the same limiter as the web door. Over the limit,
      // the user still gets matches from our own data, with no model call.
      if (await isRateLimited(this.env.ASK_RATE_LIMIT, `slack:${userKey}`)) {
        return await keywordFallback(await loadCards(this.env.ASSETS, allowFixture(this.env)), { question, filters }, "rate-limit");
      }
      return await answerQuestion(this.env, {
        question,
        history: [],
        filters,
        caller: "slack",
        callerKey: userKey,
      });
    } catch (err) {
      console.error("ResourcusRPC.ask failed:", err instanceof Error ? err.message : err);
      return ASK_ERROR_RESPONSE;
    }
  }
}
