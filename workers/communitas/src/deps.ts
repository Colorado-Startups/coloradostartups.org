// What the handlers need from the outside world, in one object. The Worker
// builds it from env; tests pass fakes. Keeping Slack, Resourcus and the rate
// limiter behind this seam is what lets signed-fixture tests run the real
// verification and routing without a network.

import type { RpcAskRequest } from "@cs/shared";

import { type Library, LIBRARY } from "./library";
import { createSlackClient, SlackApiError, type SlackClient } from "./slack";

// The ResourcusRPC contract (site/worker/rpc.ts). The binding is typed as a
// plain Service by `wrangler types`, so the answer is validated on arrival.
interface ResourcusAsker {
  ask(request: RpcAskRequest): Promise<unknown>;
}

export interface Deps {
  slack: SlackClient;
  resourcus: ResourcusAsker;
  /** True when this hashed user may ask now. */
  allowAsk(userKey: string): Promise<boolean>;
  library: Library;
  siteOrigin: string;
  userKeySalt: string;
  /** Channel id for the weekly openers; the cron posts nothing without it. */
  threadsChannel?: string;
  /** Structured log line. Never pass a raw Slack user id. */
  log(event: string, data?: Record<string, unknown>): void;
}

// Builds the live Deps from the Worker's bindings and secrets. Tests build
// their own Deps from fakes instead.
export function depsFromEnv(env: Env): Deps {
  return {
    slack: createSlackClient(env.SLACK_BOT_TOKEN ?? ""),
    resourcus: env.RESOURCUS as unknown as ResourcusAsker,
    async allowAsk(userKey) {
      // Fails open, per wrangler.jsonc: the site's budget guard is the spending stop.
      try {
        return (await env.SLACK_ASK_LIMIT.limit({ key: userKey })).success;
      } catch {
        return true;
      }
    },
    library: LIBRARY,
    siteOrigin: env.SITE_ORIGIN.replace(/\/+$/, ""),
    userKeySalt: env.USER_KEY_SALT ?? "",
    threadsChannel: env.COMMUNITAS_THREADS_CHANNEL || undefined,
    log(event, data) {
      console.log(JSON.stringify({ worker: "communitas", event, ...data }));
    },
  };
}

/** A short error label that is safe to log (no message text, no ids). */
export function errorCode(err: unknown): string {
  if (err instanceof SlackApiError) return `${err.method}:${err.code}`;
  return err instanceof Error ? err.name : "unknown";
}
