// app_mention: a member asks, Communitas answers in a thread through Resourcus.
// This runs after the 3-second ack, inside ctx.waitUntil (app.ts).
//
// Order matters: clean the question (drops raw user ids), check its length,
// hash the user, check the rate limit, ask Resourcus, validate the answer,
// then sanitize the model text and frame it with links built from our data.

import { ASK_ERROR_RESPONSE, ASK_LIMITS, type AskResponse, AskResponseSchema, type ResourceCard } from "@cs/shared";

import { type Deps, errorCode } from "./deps";
import { disclosureBlock, escapeText, mrkdwn, type RenderedMessage, siteLink } from "./format";
import { cleanQuestion, hashUserId, sanitizeModelText } from "./safety";

export interface MentionEvent {
  user?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
}

const SAFE_URL = /^https?:\/\/[^\s|<>]+$/i;

function cardLine(card: ResourceCard): string {
  const name = escapeText(card.name);
  const label = SAFE_URL.test(card.url) ? `<${card.url}|${name}>` : name;
  return `• ${label} (${escapeText(card.city)})`;
}

function formatAnswer(response: AskResponse, deps: Pick<Deps, "library" | "siteOrigin">): RenderedMessage {
  const copy = deps.library.slack.answer;
  const modelText = sanitizeModelText(response.answer);
  const lead = modelText || escapeText(copy.fallback[response.reason === "ok" ? "no-match" : response.reason]);

  const blocks: unknown[] = [{ type: "section", text: mrkdwn(lead) }];
  if (response.resources.length > 0) {
    const lines = response.resources.map(cardLine).join("\n");
    blocks.push({ type: "section", text: mrkdwn(`*${escapeText(copy.resources_heading)}*\n${lines}`) });
  }
  blocks.push({ type: "section", text: mrkdwn(siteLink(deps.siteOrigin, copy.canvas_path, copy.canvas_label)) });
  blocks.push(disclosureBlock(deps.library.disclosure.resourcus));
  return { text: lead, blocks };
}

// Answers an @Communitas mention in its thread: cleans the question, checks the
// member's rate limit, asks Resourcus over RPC and posts the reply. Bots get
// no answer.
export async function handleMention(event: MentionEvent, deps: Deps): Promise<void> {
  // Bots never get answers, Communitas included: no loops between bots.
  if (event.bot_id || event.subtype === "bot_message" || !event.user) return;
  const copy = deps.library.slack.answer;
  const thread_ts = event.thread_ts ?? event.ts;

  const reply = async (message: { text: string; blocks?: unknown[] }, data: Record<string, unknown>) => {
    try {
      await deps.slack.postMessage({ channel: event.channel, thread_ts, ...message });
      deps.log("answer_posted", data);
    } catch (err) {
      deps.log("answer_post_failed", { ...data, error: errorCode(err) });
    }
  };

  const question = cleanQuestion(event.text ?? "");
  if (question.length < 2) return reply({ text: escapeText(copy.empty_question) }, { kind: "empty" });
  if (question.length > ASK_LIMITS.maxQuestionChars) return reply({ text: escapeText(copy.too_long) }, { kind: "too_long" });

  let userKey: string;
  try {
    userKey = await hashUserId(event.user, deps.userKeySalt);
  } catch {
    deps.log("user_key_unavailable");
    return reply(formatAnswer(ASK_ERROR_RESPONSE, deps), { kind: "error" });
  }

  if (!(await deps.allowAsk(userKey))) return reply({ text: escapeText(copy.rate_limited) }, { kind: "rate_limited" });

  let response = ASK_ERROR_RESPONSE;
  try {
    const parsed = AskResponseSchema.safeParse(
      await deps.resourcus.ask({ question, caller: "slack", userKey, filters: {} }),
    );
    if (parsed.success) response = parsed.data;
    else deps.log("resourcus_invalid");
  } catch (err) {
    deps.log("resourcus_failed", { error: errorCode(err) });
  }

  await reply(formatAnswer(response, deps), {
    kind: "answer",
    mode: response.mode,
    reason: response.reason,
    resources: response.resources.length,
  });
}
