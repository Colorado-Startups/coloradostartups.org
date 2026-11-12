// The Slack door. Every request to /slack/* comes through here.
//
//   1. No signing secret: 503. Nothing can be verified, so nothing is trusted.
//      A timestamp that is not a whole number within five minutes of now gets
//      401, so a signed request cannot be replayed from the future.
//   2. Paused (decision 33): the signature is checked here, and a bad one gets
//      401. A signed url_verification gets its challenge back, so Paul can
//      install the app while paused. Every other signed request gets an empty
//      200 and is dropped, logged as paused_drop with its route key only
//      (event:app_mention, command:/communitas). Slack disables event
//      delivery for an endpoint that keeps failing, so a 503 here could leave
//      events off at launch. Paused still means no posts, no DMs and no model
//      calls.
//   3. No bot token or no salt: 503.
//   4. slack-cloudflare-workers verifies the signature (401 when it fails) and
//      routes. Retries are dropped before routing: the Worker keeps no state,
//      so a retried team_join would otherwise send a second welcome. Payloads
//      other than app_mention, team_join and /communitas are dropped too, with
//      an unhandled_drop log line that holds only their route key.
//
// Authorization is local. The library's default calls auth.test on every
// request, before the ack; this one returns the bot token without a network
// call. Its built-in self-event filter needs bot ids from auth.test, so it is
// off, and handleMention ignores every bot instead.

import { type MessageResponse, SlackApp, verifySlackRequest } from "slack-cloudflare-workers";

import { handleMention, type MentionEvent } from "./answer";
import { helpResponse } from "./commands";
import type { Deps } from "./deps";
import { isPaused } from "./pause";
import { handleTeamJoin, type JoinedUser } from "./welcome";

const unavailable = () => new Response(null, { status: 503 });

const SAFE_TYPE = /^[a-z_.:/]{1,40}$/;
const safeType = (type: unknown) => (typeof type === "string" && SAFE_TYPE.test(type) ? type : "unknown");

// Slack signs "v0:<timestamp>:<body>", and slack-edge rejects only old
// timestamps. This also rejects future-dated and malformed ones, on both the
// paused and the live path: a whole number of seconds within five minutes.
const MAX_SKEW_SECONDS = 300;
function freshTimestamp(headers: Headers): boolean {
  const value = headers.get("x-slack-request-timestamp") ?? "";
  if (!/^\d{1,12}$/.test(value)) return false;
  return Math.abs(Math.floor(Date.now() / 1000) - Number(value)) <= MAX_SKEW_SECONDS;
}

// The only payloads Communitas acts on. Anything else is dropped before
// routing, because slack-edge logs the full body of a payload with no handler,
// and that body carries raw user ids.
const HANDLED = new Set(["url_verification", "event:app_mention", "event:team_join", "command:/communitas"]);

type SlackBody = { type?: unknown; command?: unknown; event?: { type?: unknown } };

// One key per payload kind. HANDLED matches it, and the drop logs carry it
// through safeType, so a log line never holds more than the kind.
function routeKey(body: SlackBody): string {
  if (body.type === "event_callback") return `event:${String(body.event?.type)}`;
  if (!body.type && typeof body.command === "string") return `command:${body.command}`;
  return String(body.type);
}

// What a paused request was, for the log and the URL check. Never logs ids.
// Events are JSON and slash commands are a form, so JSON is read first. Only
// a body that is not JSON is read as a form, so a mention whose text or blocks
// hold "&command=" still logs as event:app_mention.
function describe(raw: string): { type: string; challenge?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const command = new URLSearchParams(raw).get("command");
    return { type: command === null ? "unknown" : safeType(routeKey({ command })) };
  }
  try {
    const body = parsed as SlackBody & { challenge?: unknown };
    if (body.type === "url_verification" && typeof body.challenge === "string") {
      return { type: "url_verification", challenge: body.challenge };
    }
    return { type: safeType(routeKey(body)) };
  } catch {
    // JSON.parse("null") returns null, and routeKey(null) throws.
    return { type: "unknown" };
  }
}

async function pausedResponse(request: Request, secret: string, makeDeps: () => Deps): Promise<Response> {
  const raw = await request.text();
  if (!(await verifySlackRequest(secret, request.headers, raw))) {
    return new Response("Invalid signature", { status: 401 });
  }
  const { type, challenge } = describe(raw);
  if (challenge !== undefined) {
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  makeDeps().log("paused_drop", { type });
  return new Response("", { status: 200 });
}

function buildApp(secret: string, botToken: string, deps: Deps) {
  const app = new SlackApp({
    env: { SLACK_SIGNING_SECRET: secret, SLACK_BOT_TOKEN: botToken, SLACK_LOGGING_LEVEL: "ERROR" },
    authorize: async () => ({ botToken, botId: "", botUserId: "", botScopes: [] }),
    ignoreSelfEvents: false,
  });

  app.beforeAuthorize(async (req) => {
    if (req.retryNum !== undefined) return { status: 200, body: "" };
    if (!HANDLED.has(routeKey(req.body ?? {}))) {
      deps.log("unhandled_drop", { type: safeType(routeKey(req.body ?? {})) });
      return { status: 200, body: "" };
    }
  });

  app.event("app_mention", async ({ payload }) => {
    await handleMention(payload as MentionEvent, deps);
  });

  app.event("team_join", async ({ payload }) => {
    await handleTeamJoin(payload.user as JoinedUser, deps);
  });

  // format.ts builds plain block objects; the library types them as a union.
  app.command("/communitas", async () => helpResponse(deps) as MessageResponse);

  return app;
}

// The secrets come from env.d.ts. The pause flag is typed as isPaused reads
// it, because the generated Env pins COMMUNITAS_PAUSED to wrangler.jsonc's "true".
export async function handleSlackRequest(
  request: Request,
  env: Pick<Env, "SLACK_SIGNING_SECRET" | "SLACK_BOT_TOKEN" | "USER_KEY_SALT"> & Parameters<typeof isPaused>[0],
  ctx: ExecutionContext,
  makeDeps: () => Deps,
): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const secret = env.SLACK_SIGNING_SECRET;
  if (!secret) return unavailable();
  if (!freshTimestamp(request.headers)) return new Response("Invalid signature", { status: 401 });

  if (isPaused(env)) return pausedResponse(request, secret, makeDeps);

  if (!env.SLACK_BOT_TOKEN || !env.USER_KEY_SALT) return unavailable();
  return buildApp(secret, env.SLACK_BOT_TOKEN, makeDeps()).run(request, ctx);
}
