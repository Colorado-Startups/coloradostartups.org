// Test doubles for Communitas's dependencies. Handlers take a Deps object, so
// tests swap Slack, Resourcus and the rate limiter at the function boundary and
// assert on what Communitas tried to send.

import type { AskResponse, RpcAskRequest } from "@cs/shared";

import type { Deps } from "../src/deps";
import { LIBRARY } from "../src/library";
import type { SlackPost } from "../src/slack";

export interface Recorder {
  posts: SlackPost[];
  dmsOpened: string[];
  asks: RpcAskRequest[];
  logs: { event: string; data?: Record<string, unknown> }[];
}

export const SITE = "https://coloradostartups.example";

export const CARD = {
  id: "boulder-founders-lab",
  name: "Boulder Founders Lab",
  url: "https://founders-lab.example/",
  stage: "idea",
  substage: "validate",
  city: "Boulder",
  type: "accelerator",
  description: "A cohort program for first-time founders.",
} as const;

export function okAnswer(over: Partial<AskResponse> = {}): AskResponse {
  return {
    answer: "Boulder Founders Lab runs a cohort for first-time founders.",
    citations: [CARD.id],
    resources: [{ ...CARD }],
    mode: "model",
    reason: "ok",
    ...over,
  };
}

export function fakeDeps(
  options: {
    answer?: unknown | (() => Promise<unknown>);
    allow?: boolean | (() => Promise<boolean>);
    threadsChannel?: string;
    failPost?: boolean;
  } = {},
): { deps: Deps; rec: Recorder } {
  const rec: Recorder = { posts: [], dmsOpened: [], asks: [], logs: [] };
  const deps: Deps = {
    slack: {
      async postMessage(message) {
        if (options.failPost) throw new Error("slack down");
        rec.posts.push(message);
        return { ts: "1700000000.000100" };
      },
      async openDm(userId) {
        rec.dmsOpened.push(userId);
        return `D-${userId}`;
      },
    },
    resourcus: {
      async ask(request) {
        rec.asks.push(request);
        const a = options.answer ?? okAnswer();
        return typeof a === "function" ? (a as () => Promise<unknown>)() : a;
      },
    },
    async allowAsk() {
      const allow = options.allow ?? true;
      return typeof allow === "function" ? allow() : allow;
    },
    library: LIBRARY,
    siteOrigin: SITE,
    userKeySalt: "test-salt",
    threadsChannel: options.threadsChannel,
    log(event, data) {
      rec.logs.push({ event, data });
    },
  };
  return { deps, rec };
}
