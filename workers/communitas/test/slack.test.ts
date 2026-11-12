import { describe, expect, it } from "vitest";

import { createSlackClient, SlackApiError } from "../src/slack";

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(reply: unknown, status = 200) {
  const calls: Captured[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(reply), { status, headers: { "Content-Type": "application/json" } });
  };
  return { impl: impl as typeof fetch, calls };
}

describe("the Slack client every message goes through", () => {
  it("posts with link_names false and unfurls off, using the bot token", async () => {
    const f = fakeFetch({ ok: true, ts: "1.2" });
    const slack = createSlackClient("xoxb-test", f.impl);
    await slack.postMessage({ channel: "C1", text: "hello" });

    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call.url).toBe("https://slack.com/api/chat.postMessage");
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer xoxb-test");
    expect(call.body).toMatchObject({
      channel: "C1",
      text: "hello",
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it("does not let a caller turn link_names or unfurls back on", async () => {
    const f = fakeFetch({ ok: true });
    const slack = createSlackClient("xoxb-test", f.impl);
    await slack.postMessage({ channel: "C1", text: "x", link_names: true, unfurl_links: true } as never);
    expect(f.calls[0].body).toMatchObject({ link_names: false, unfurl_links: false, unfurl_media: false });
  });

  it("passes thread_ts and blocks through", async () => {
    const f = fakeFetch({ ok: true });
    const slack = createSlackClient("xoxb-test", f.impl);
    await slack.postMessage({ channel: "C1", text: "x", thread_ts: "9.9", blocks: [{ type: "divider" }] });
    expect(f.calls[0].body).toMatchObject({ thread_ts: "9.9", blocks: [{ type: "divider" }] });
  });

  it("opens a DM and returns its channel id", async () => {
    const f = fakeFetch({ ok: true, channel: { id: "D42" } });
    const slack = createSlackClient("xoxb-test", f.impl);
    await expect(slack.openDm("U7")).resolves.toBe("D42");
    expect(f.calls[0].url).toBe("https://slack.com/api/conversations.open");
    expect(f.calls[0].body).toEqual({ users: "U7" });
  });

  it("throws SlackApiError when Slack answers ok: false", async () => {
    const f = fakeFetch({ ok: false, error: "not_in_channel" });
    const slack = createSlackClient("xoxb-test", f.impl);
    await expect(slack.postMessage({ channel: "C1", text: "x" })).rejects.toMatchObject({
      name: "SlackApiError",
      code: "not_in_channel",
    });
  });

  it("throws on an HTTP error", async () => {
    const f = fakeFetch({}, 500);
    const slack = createSlackClient("xoxb-test", f.impl);
    await expect(slack.postMessage({ channel: "C1", text: "x" })).rejects.toBeInstanceOf(SlackApiError);
  });
});
