// Ask contracts: question limits, the request shapes and the answer shape.

import * as z from "zod";

import { ResourceCardSchema, ResourceFiltersSchema } from "./resource";

// Limits shared by the web path and the Slack path. L4 may propose new values;
// the orchestrator changes them here so every caller agrees.
export const ASK_LIMITS = {
  maxQuestionChars: 600,
  // The longest history turn. The panel sends each answer back as an
  // assistant turn, so the Worker caps answers at this length too
  // (MAX_ANSWER_CHARS in site/worker/resourcus/output.ts).
  maxTurnChars: 1200,
  maxHistoryTurns: 6,
  maxHistoryChars: 3000,
  maxCitations: 5,
} as const;

export const AskTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(ASK_LIMITS.maxTurnChars),
});

// POST /api/ask (public web). The schema rejects any role other than user and
// assistant, so a client cannot inject a system turn; the Worker uses only
// user turns.
export const AskRequestSchema = z.object({
  question: z.string().trim().min(2).max(ASK_LIMITS.maxQuestionChars),
  history: z.array(AskTurnSchema).max(ASK_LIMITS.maxHistoryTurns).default([]),
  filters: ResourceFiltersSchema.default({}),
  turnstileToken: z.string().max(4096).optional(),
  sessionId: z.string().max(64).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

// ResourcusRPC.ask() input (Slack through the service binding). No Turnstile:
// the binding has no public URL. userKey is a salted hash of the Slack user id.
export const RpcAskRequestSchema = z.object({
  question: z.string().trim().min(2).max(ASK_LIMITS.maxQuestionChars),
  caller: z.literal("slack"),
  userKey: z.string().min(8).max(128),
  filters: ResourceFiltersSchema.default({}),
});
export type RpcAskRequest = z.infer<typeof RpcAskRequestSchema>;

// The answer every caller gets. `mode` says whether a model wrote it or the
// keyword fallback did (budget guard, model error, rate limit).
export const AskResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()).max(ASK_LIMITS.maxCitations),
  resources: z.array(ResourceCardSchema).max(ASK_LIMITS.maxCitations),
  mode: z.enum(["model", "fallback"]),
  reason: z.enum(["ok", "budget", "rate-limit", "error", "unsafe", "no-match"]).default("ok"),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

// The reply when an ask cannot run at all: bad input, or a failure before any
// fallback. ResourcusRPC returns it, and Communitas formats it for Slack.
export const ASK_ERROR_RESPONSE: AskResponse = {
  answer: "",
  citations: [],
  resources: [],
  mode: "fallback",
  reason: "error",
};
