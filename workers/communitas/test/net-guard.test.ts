// The pool's network guard (net-guard-setup.ts): with no fetchImpl,
// createSlackClient falls back to the real fetch(), and the guard blocks it
// before it can reach Slack (#660). Loopback stays open for the pool.

import { describe, expect, it } from "vitest";

import { blocked } from "../../../site/test/worker/net-guard";
import { createSlackClient } from "../src/slack";

describe("the network guard", () => {
  it("blocks the real Slack API when a test passes no fetchImpl", async () => {
    await expect(createSlackClient("xoxb-test").postMessage({ channel: "C1", text: "hi" })).rejects.toThrow(
      /Network guard/,
    );
    expect(blocked.splice(0)).toEqual(["POST https://slack.com/api/chat.postMessage"]);
  });

  it("blocks a host with a trailing dot", async () => {
    await expect(fetch("https://slack.com./api/chat.postMessage", { method: "POST" })).rejects.toThrow();
    expect(blocked.splice(0)).toEqual(["POST https://slack.com./api/chat.postMessage"]);
  });
});
