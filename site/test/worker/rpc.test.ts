import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ASK_LIMIT, burstOver } from "./rate-limit";

// Proves the Slack path works the way production wires it: a service binding
// with entrypoint "ResourcusRPC" reaching the named WorkerEntrypoint export of
// this Worker (plan, Wave 0 step 3).
//
// Expectations updated by L4 (decision 26): the test pool's AI binding rejects
// every call, so the core fails closed to the keyword fallback with reason
// "error". The model path itself is covered by test/worker/l4/.
describe("ResourcusRPC over a service binding", () => {
  it("answers a valid Slack question with cards", async () => {
    const res = await env.RESOURCUS_SELF.ask({
      question: "accelerator with a demo day",
      caller: "slack",
      userKey: "hashed-user-key-123",
    });
    expect(res.mode).toBe("fallback");
    expect(res.reason).toBe("error");
    expect(res.citations).toContain("fx-headframe-accelerator");
    expect(res.resources.map((r) => r.id)).toEqual(res.citations);
  });

  it("returns an error fallback instead of throwing on bad input", async () => {
    const res = await env.RESOURCUS_SELF.ask({ question: "hi", caller: "web" });
    expect(res).toEqual({ answer: "", citations: [], resources: [], mode: "fallback", reason: "error" });
  });

  it("limits per hashed Slack user and still answers from our data", async () => {
    // ASK_RATE_LIMIT allows 20 per 60 s per key (wrangler.jsonc).
    // burstOver sends enough to trip it even across a window edge (#339).
    const ask = (userKey: string) =>
      env.RESOURCUS_SELF.ask({ question: "coworking desks", caller: "slack", userKey });
    const answers: Awaited<ReturnType<typeof ask>>[] = [];
    for (let i = 0; i < burstOver(ASK_LIMIT); i++) answers.push(await ask("slack-user-flood-1"));
    expect(answers.slice(0, ASK_LIMIT).every((a) => a.reason !== "rate-limit")).toBe(true);
    const limited = answers.find((a) => a.reason === "rate-limit");
    expect(limited).toBeDefined();
    expect(limited?.citations).toContain("fx-ore-cart-coworking");
    expect((await ask("slack-user-other-2")).reason).not.toBe("rate-limit");
  });
});
