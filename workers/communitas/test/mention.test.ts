import { describe, expect, it } from "vitest";

import { handleMention } from "../src/answer";
import { LIBRARY } from "../src/library";
import { hashUserId } from "../src/safety";
import { CARD, fakeDeps, okAnswer, SITE } from "./helpers";

const mention = {
  type: "app_mention",
  user: "U0ASKER",
  channel: "C0GENERAL",
  ts: "1700000000.000001",
  text: "<@U0BOT> who helps first-time founders in Boulder?",
};

const postedText = (post: { text: string; blocks?: unknown[] }) => `${post.text}\n${JSON.stringify(post.blocks)}`;

describe("app_mention: answers in a thread through Resourcus", () => {
  it("asks Resourcus with the cleaned question, caller slack and a hashed user key", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention(mention, deps);
    expect(rec.asks).toEqual([
      {
        question: "who helps first-time founders in Boulder?",
        caller: "slack",
        userKey: await hashUserId("U0ASKER", "test-salt"),
        filters: {},
      },
    ]);
    expect(JSON.stringify(rec.asks)).not.toContain("U0ASKER");
    expect(JSON.stringify(rec.asks)).not.toContain("U0BOT");
  });

  it("replies in a thread under the mention", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention(mention, deps);
    expect(rec.posts).toHaveLength(1);
    expect(rec.posts[0]).toMatchObject({ channel: "C0GENERAL", thread_ts: mention.ts });
  });

  it("stays in the existing thread when mentioned inside one", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention({ ...mention, ts: "1700000000.000009", thread_ts: "1700000000.000001" }, deps);
    expect(rec.posts[0].thread_ts).toBe("1700000000.000001");
  });

  it("strips mass mentions, user mentions, channel links and URLs from model text", async () => {
    const answer = "<!channel> <!here> Ask <@U123> in <#C9|general> or see https://evil.example/x and <https://evil.example|this>.";
    const { deps, rec } = fakeDeps({ answer: okAnswer({ answer }) });
    await handleMention(mention, deps);
    const out = postedText(rec.posts[0]);
    expect(out).not.toMatch(/<!|<@|<#|evil\.example/);
    expect(out).toContain("Ask in or see and .");
  });

  it("links resources from our own card data, never from model text", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention(mention, deps);
    const out = postedText(rec.posts[0]);
    expect(out).toContain(`<${CARD.url}|${CARD.name}>`);
    expect(out).toContain(`<${SITE}${LIBRARY.slack.answer.canvas_path}|${LIBRARY.slack.answer.canvas_label}>`);
  });

  it("does not link a card whose URL is not http or https", async () => {
    const bad = { ...CARD, url: "javascript:alert(1)", name: "Bad <Card>" };
    const { deps, rec } = fakeDeps({ answer: okAnswer({ resources: [bad] }) });
    await handleMention(mention, deps);
    const out = postedText(rec.posts[0]);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("Bad &lt;Card&gt;");
  });

  it("discloses that Resourcus is an AI agent", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention(mention, deps);
    expect(postedText(rec.posts[0])).toContain(LIBRARY.disclosure.resourcus);
  });

  it("ignores mentions from bots, including itself", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention({ ...mention, bot_id: "B0OTHER" }, deps);
    await handleMention({ ...mention, subtype: "bot_message" }, deps);
    expect(rec.asks).toEqual([]);
    expect(rec.posts).toEqual([]);
  });

  it("answers a bare mention with the example question, without asking Resourcus", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention({ ...mention, text: "<@U0BOT>" }, deps);
    expect(rec.asks).toEqual([]);
    expect(rec.posts[0].text).toContain("Ask me about Colorado startup resources.");
  });

  it("asks for a shorter question past the shared length limit", async () => {
    const { deps, rec } = fakeDeps();
    await handleMention({ ...mention, text: `<@U0BOT> ${"why ".repeat(200)}` }, deps);
    expect(rec.asks).toEqual([]);
    expect(rec.posts[0].text).toBe(LIBRARY.slack.answer.too_long);
  });

  it("tells a member who is over the rate limit, without asking Resourcus", async () => {
    const { deps, rec } = fakeDeps({ allow: false });
    await handleMention(mention, deps);
    expect(rec.asks).toEqual([]);
    expect(rec.posts[0].text).toBe(LIBRARY.slack.answer.rate_limited);
  });

  it("falls back to the Canvas when Resourcus throws", async () => {
    const { deps, rec } = fakeDeps({
      answer: async () => {
        throw new Error("rpc down");
      },
    });
    await handleMention(mention, deps);
    const out = postedText(rec.posts[0]);
    expect(out).toContain(LIBRARY.slack.answer.fallback.error);
    expect(out).toContain(LIBRARY.slack.answer.canvas_label);
    expect(rec.logs.map((l) => l.event)).toContain("resourcus_failed");
  });

  it("falls back when Resourcus returns something that is not an AskResponse", async () => {
    const { deps, rec } = fakeDeps({ answer: { answer: 42 } });
    await handleMention(mention, deps);
    expect(rec.posts[0].text).toContain(LIBRARY.slack.answer.fallback.error);
  });

  it("explains a budget fallback and still lists the matches", async () => {
    const { deps, rec } = fakeDeps({ answer: okAnswer({ answer: "", mode: "fallback", reason: "budget" }) });
    await handleMention(mention, deps);
    const out = postedText(rec.posts[0]);
    expect(out).toContain(LIBRARY.slack.answer.fallback.budget);
    expect(out).toContain(`<${CARD.url}|${CARD.name}>`);
  });

  it("logs a Slack failure without raw ids and does not throw", async () => {
    const { deps, rec } = fakeDeps({ failPost: true });
    await expect(handleMention(mention, deps)).resolves.toBeUndefined();
    expect(rec.logs.map((l) => l.event)).toContain("answer_post_failed");
    expect(JSON.stringify(rec.logs)).not.toMatch(/U0ASKER|C0GENERAL/);
  });
});
