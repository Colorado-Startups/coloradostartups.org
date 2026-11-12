// #189: the Resourcus panel sends each answer back as an assistant history
// turn (site/src/components/resourcus/panel.ts). If the Worker's answer cap
// and AskTurnSchema's turn cap drift apart, every follow-up to a long answer
// gets a 400. Both read ASK_LIMITS.maxTurnChars; these fail if either stops.
import { ASK_ERROR_RESPONSE, ASK_LIMITS, AskRequestSchema, AskResponseSchema, AskTurnSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { capLength, MAX_ANSWER_CHARS, sanitizeAnswer } from "../../worker/resourcus/output";

describe("the answer cap and the history-turn cap", () => {
  it("are the same number, ASK_LIMITS.maxTurnChars", () => {
    expect(MAX_ANSWER_CHARS).toBe(ASK_LIMITS.maxTurnChars);
  });

  it("let the longest answer back in as a history turn, and refuse one character more", () => {
    const longest = capLength("x".repeat(ASK_LIMITS.maxTurnChars * 4));
    expect(longest).toHaveLength(ASK_LIMITS.maxTurnChars);
    expect(AskTurnSchema.safeParse({ role: "assistant", content: longest }).success).toBe(true);
    expect(AskTurnSchema.safeParse({ role: "assistant", content: `${longest}x` }).success).toBe(false);
  });

  it("let a follow-up carry a long sanitized answer in its history", () => {
    const answer = sanitizeAnswer("Founders can ask the clinic about incorporation. ".repeat(100));
    expect(answer.length).toBeLessThanOrEqual(ASK_LIMITS.maxTurnChars);
    const followUp = AskRequestSchema.safeParse({
      question: "What about trademarks?",
      history: [
        { role: "user", content: "Where can I get legal help?" },
        { role: "assistant", content: answer },
      ],
    });
    expect(followUp.success).toBe(true);
  });
});

describe("ASK_ERROR_RESPONSE", () => {
  it("is a valid AskResponse with no answer and reason error", () => {
    expect(AskResponseSchema.parse(ASK_ERROR_RESPONSE)).toEqual({
      answer: "",
      citations: [],
      resources: [],
      mode: "fallback",
      reason: "error",
    });
  });
});
