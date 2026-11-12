import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleSlackRequest } from "../src/app";
import { LIBRARY } from "../src/library";
import { appMention, signedRequest, slashCommand, teamJoin, urlVerification } from "./fixtures";
import { fakeDeps, okAnswer } from "./helpers";

// End to end inside workerd: a signed request goes through the real signature
// check and routing in slack-cloudflare-workers, then into the handlers with
// fake Slack and Resourcus. Nothing here reaches the network.

type SlackEnv = Parameters<typeof handleSlackRequest>[1];

const AWAKE: SlackEnv = {
  SLACK_SIGNING_SECRET: "test-signing-secret",
  SLACK_BOT_TOKEN: "xoxb-test",
  USER_KEY_SALT: "test-salt",
  COMMUNITAS_PAUSED: "false",
};
const PAUSED: SlackEnv = { ...AWAKE, COMMUNITAS_PAUSED: "true" };

async function send(request: Request, env: SlackEnv, deps = fakeDeps()) {
  const ctx = createExecutionContext();
  const res = await handleSlackRequest(request, env, ctx, () => deps.deps);
  await waitOnExecutionContext(ctx);
  return { res, rec: deps.rec };
}

describe("request verification", () => {
  it("rejects a bad signature with 401 and sends nothing", async () => {
    const req = await signedRequest("/slack/events", appMention(), { secret: "wrong-secret" });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(401);
    expect(rec.asks).toEqual([]);
    expect(rec.posts).toEqual([]);
  });

  it("rejects a request with no signature headers", async () => {
    const req = await signedRequest("/slack/events", appMention(), { unsigned: true });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(401);
    expect(rec.posts).toEqual([]);
  });

  it("rejects a replayed request older than five minutes", async () => {
    const req = await signedRequest("/slack/events", appMention(), { timestamp: Math.floor(Date.now() / 1000) - 600 });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(401);
    expect(rec.posts).toEqual([]);
  });

  it.each([
    ["dated 10 minutes in the future", Math.floor(Date.now() / 1000) + 600],
    ["with a timestamp that is not a number", "12abc"],
    ["with a fractional timestamp", `${Math.floor(Date.now() / 1000)}.5`],
  ])("rejects a correctly signed request %s, awake or paused", async (_label, timestamp) => {
    for (const env of [AWAKE, PAUSED]) {
      const { res, rec } = await send(await signedRequest("/slack/events", appMention(), { timestamp }), env);
      expect(res.status).toBe(401);
      expect(rec.asks).toEqual([]);
      expect(rec.logs).toEqual([]);
    }
  });

  it("answers Slack's URL check", async () => {
    const { res } = await send(await signedRequest("/slack/events", urlVerification()), AWAKE);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-abc123");
  });

  it("refuses everything with 503 when the signing secret is missing", async () => {
    const env = { ...AWAKE, SLACK_SIGNING_SECRET: undefined };
    const { res, rec } = await send(await signedRequest("/slack/events", appMention()), env);
    expect(res.status).toBe(503);
    expect(rec.posts).toEqual([]);
  });

  it("refuses events with 503 when the bot token or salt is missing", async () => {
    for (const env of [
      { ...AWAKE, SLACK_BOT_TOKEN: undefined },
      { ...AWAKE, USER_KEY_SALT: undefined },
    ]) {
      const { res, rec } = await send(await signedRequest("/slack/events", appMention()), env);
      expect(res.status).toBe(503);
      expect(rec.asks).toEqual([]);
    }
  });
});

// Decision 33: while paused, signed events get a 200 and are dropped, so Slack
// never sees a failing endpoint and never disables event delivery before launch.
// Paused still means no posts, no DMs and no model calls.
describe("while paused", () => {
  it("acks a signed mention with 200, asks nothing and posts nothing", async () => {
    const { res, rec } = await send(await signedRequest("/slack/events", appMention()), PAUSED);
    expect(res.status).toBe(200);
    expect(rec.asks).toEqual([]);
    expect(rec.posts).toEqual([]);
  });

  it("acks a signed team_join with 200 and sends no DM", async () => {
    const { res, rec } = await send(await signedRequest("/slack/events", teamJoin()), PAUSED);
    expect(res.status).toBe(200);
    expect(rec.dmsOpened).toEqual([]);
    expect(rec.posts).toEqual([]);
  });

  it("acks a signed slash command with an empty 200", async () => {
    const req = await signedRequest("/slack/commands", slashCommand("help"), {
      contentType: "application/x-www-form-urlencoded",
    });
    const { res, rec } = await send(req, PAUSED);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(rec.posts).toEqual([]);
  });

  it("logs paused_drop with the route key only", async () => {
    const { rec } = await send(await signedRequest("/slack/events", appMention()), PAUSED);
    expect(rec.logs).toEqual([{ event: "paused_drop", data: { type: "event:app_mention" } }]);
  });

  it("logs a paused slash command by its route key, the key unhandled_drop uses", async () => {
    const req = await signedRequest("/slack/commands", slashCommand("help"), {
      contentType: "application/x-www-form-urlencoded",
    });
    const { rec } = await send(req, PAUSED);
    expect(rec.logs).toEqual([{ event: "paused_drop", data: { type: "command:/communitas" } }]);
  });

  it("logs a paused mention as a mention when a link in it holds &command=", async () => {
    // A form parse of this JSON body would read command=jane_doe.home.
    const url = "https://example.org/?x=1&command=jane_doe.home&ref=slack";
    const body = appMention({
      text: "<@U0BOT> what is this link?",
      blocks: [
        {
          type: "rich_text",
          elements: [{ type: "rich_text_section", elements: [{ type: "link", url }] }],
        },
      ],
    });
    const { res, rec } = await send(await signedRequest("/slack/events", body), PAUSED);
    expect(res.status).toBe(200);
    expect(rec.logs).toEqual([{ event: "paused_drop", data: { type: "event:app_mention" } }]);
    expect(JSON.stringify(rec.logs)).not.toContain("jane_doe");
  });

  it("rejects a bad signature with 401", async () => {
    const req = await signedRequest("/slack/events", appMention(), { secret: "wrong-secret" });
    const { res, rec } = await send(req, PAUSED);
    expect(res.status).toBe(401);
    expect(rec.logs).toEqual([]);
  });

  it("still answers a signed URL check, so the app can be installed before it is unpaused", async () => {
    const { res, rec } = await send(await signedRequest("/slack/events", urlVerification()), PAUSED);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-abc123");
    expect(rec.posts).toEqual([]);
  });

  it("rejects an unsigned URL check with 401", async () => {
    const req = await signedRequest("/slack/events", urlVerification(), { unsigned: true });
    const { res } = await send(req, PAUSED);
    expect(res.status).toBe(401);
  });
});

describe("app_mention", () => {
  it("acks before Resourcus answers, then answers in a thread", async () => {
    let release!: (v: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const deps = fakeDeps({ answer: () => pending });
    const ctx = createExecutionContext();

    const res = await handleSlackRequest(await signedRequest("/slack/events", appMention()), AWAKE, ctx, () => deps.deps);
    expect(res.status).toBe(200);
    expect(deps.rec.posts).toEqual([]);

    release(okAnswer());
    await waitOnExecutionContext(ctx);
    expect(deps.rec.asks).toHaveLength(1);
    expect(deps.rec.posts).toHaveLength(1);
    expect(deps.rec.posts[0]).toMatchObject({ channel: "C0GENERAL", thread_ts: "1700000000.000001" });
  });

  it("drops Slack's retries, so one mention gets one answer", async () => {
    const req = await signedRequest("/slack/events", appMention(), {
      headers: { "X-Slack-Retry-Num": "1", "X-Slack-Retry-Reason": "http_timeout" },
    });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(200);
    expect(rec.asks).toEqual([]);
    expect(rec.posts).toEqual([]);
  });

  it("ignores a mention posted by another bot", async () => {
    const { rec } = await send(await signedRequest("/slack/events", appMention({ bot_id: "B0OTHER" })), AWAKE);
    expect(rec.asks).toEqual([]);
    expect(rec.posts).toEqual([]);
  });
});

describe("team_join", () => {
  it("sends one welcome DM", async () => {
    const { res, rec } = await send(await signedRequest("/slack/events", teamJoin()), AWAKE);
    expect(res.status).toBe(200);
    expect(rec.dmsOpened).toEqual(["U0NEW"]);
    expect(rec.posts).toHaveLength(1);
    expect(rec.posts[0].text).toContain(LIBRARY.slack.welcome.lines[0]);
  });

  it("drops Slack's retries, so a member is welcomed once", async () => {
    const req = await signedRequest("/slack/events", teamJoin(), { headers: { "X-Slack-Retry-Num": "2" } });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(200);
    expect(rec.dmsOpened).toEqual([]);
  });

  it("sends nothing when a bot joins", async () => {
    const { rec } = await send(await signedRequest("/slack/events", teamJoin({ is_bot: true })), AWAKE);
    expect(rec.dmsOpened).toEqual([]);
  });
});

describe("/communitas", () => {
  it("returns the private help card in the ack", async () => {
    const req = await signedRequest("/slack/commands", slashCommand("help"), {
      contentType: "application/x-www-form-urlencoded",
    });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { response_type: string; text: string };
    expect(body.response_type).toBe("ephemeral");
    expect(body.text).toContain(LIBRARY.slack.help.lines[0]);
    expect(rec.posts).toEqual([]);
  });
});

// Review item 3: slack-edge logs the whole body of a signed payload that has no
// handler. Anything Communitas does not handle is dropped first, logged by type.
describe("payloads Communitas does not handle", () => {
  const message = () =>
    JSON.stringify({
      type: "event_callback",
      team_id: "T0TEST",
      event: { type: "message", user: "U0ASKER", text: "hello", channel: "C0GENERAL", ts: "1.1" },
    });

  it("acks an unhandled event with 200 and logs only its type", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      const { res, rec } = await send(await signedRequest("/slack/events", message()), AWAKE);
      expect(res.status).toBe(200);
      expect(rec.posts).toEqual([]);
      expect(rec.logs).toEqual([{ event: "unhandled_drop", data: { type: "event:message" } }]);
      expect(lines.join("\n")).not.toMatch(/U0ASKER|C0GENERAL/);
    } finally {
      console.log = original;
    }
  });

  it("drops a slash command other than /communitas", async () => {
    const body = slashCommand("x").replace("%2Fcommunitas", "%2Fother");
    const req = await signedRequest("/slack/commands", body, { contentType: "application/x-www-form-urlencoded" });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(200);
    expect(rec.logs).toEqual([{ event: "unhandled_drop", data: { type: "command:/other" } }]);
  });

  it("drops an interactivity payload such as a block action", async () => {
    const body = new URLSearchParams({
      payload: JSON.stringify({ type: "block_actions", user: { id: "U0ASKER" }, actions: [] }),
    }).toString();
    const req = await signedRequest("/slack/events", body, { contentType: "application/x-www-form-urlencoded" });
    const { res, rec } = await send(req, AWAKE);
    expect(res.status).toBe(200);
    expect(rec.logs).toEqual([{ event: "unhandled_drop", data: { type: "block_actions" } }]);
  });
});
