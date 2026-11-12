// Communitas, the keeper of the doors: the Colorado Startups Slack app.
// Owner: L5. Its own Slack app and bot token, on Cloudflare Workers. It answers
// through Resourcus on an open model, and it is not connected to any Claude
// account.
//
//   POST /slack/events     Slack Events API: app_mention, team_join (app.ts)
//   POST /slack/commands   /communitas help card (app.ts)
//   GET  /                 health check ("paused" or "awake")
//   scheduled()            weekly openers from data/communitas/threads.yaml
//
// Rules, and where each one lives:
//   - ack within 3 seconds, answer in a thread with ctx.waitUntil   app.ts, answer.ts
//   - post with link_names false and unfurls off                   slack.ts
//   - strip <!channel>, <!here>, <@...> and <#...> from model text  safety.ts
//   - hash Slack user ids with USER_KEY_SALT before they leave      safety.ts, answer.ts
//   - one welcome DM on team_join, never any other unprompted DM    welcome.ts, app.ts
//   - do nothing at all while COMMUNITAS_PAUSED is "true"           pause.ts, app.ts, threads.ts

import { handleSlackRequest } from "./app";
import { depsFromEnv } from "./deps";
import { isPaused } from "./pause";
import { handleScheduled } from "./threads";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(isPaused(env) ? "Communitas is paused." : "Communitas is awake.", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (url.pathname === "/slack/events" || url.pathname === "/slack/commands") {
      return handleSlackRequest(request, env, ctx, () => depsFromEnv(env));
    }
    return new Response("Not found", { status: 404 });
  },

  // handleScheduled checks the pause itself, so the cron does nothing while paused.
  async scheduled(controller, env): Promise<void> {
    await handleScheduled(controller.scheduledTime, env, depsFromEnv(env));
  },
} satisfies ExportedHandler<Env>;
