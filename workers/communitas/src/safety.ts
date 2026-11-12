// Text safety for Communitas. Two directions, two rules:
//
//   sanitizeModelText()  model text going INTO Slack. Nothing a model writes may
//                        ping people or carry a link. Strip, then escape.
//   cleanQuestion()      member text going OUT to Resourcus. No raw Slack user
//                        id leaves this Worker, so every user mention is dropped.
//
// The posting side adds a third layer: every message goes out with
// link_names false, unfurls off and verbatim mrkdwn (see slack.ts).

import { escapeText } from "./format";

// Section blocks hold 3,000 characters (Slack Block Kit reference). The cap
// leaves room for the footer that follows the answer.
const MAX_ANSWER_CHARS = 2800;

const SLACK_LINK = /<(?:https?|mailto):[^>]*>/gi;
const SPECIAL_MENTION = /<![^>]*>/g;
const USER_OR_CHANNEL = /<[@#][^>]*>/g;
// Any scheme, even glued to a word ("visithttps://..."), and bare domains
// ("evil.com/login"). Answers cite resources by id and their cards come from
// site data, so model text never needs a domain of its own.
const RAW_URL = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi;
const PLAIN_MASS_MENTION = /(^|\s)@(?:channel|here|everyone)\b/gi;

function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Makes model text safe to post: strips links, mentions and domains, escapes
// it, and cuts it to MAX_ANSWER_CHARS.
export function sanitizeModelText(text: string): string {
  const stripped = text
    .replace(SLACK_LINK, "")
    .replace(SPECIAL_MENTION, "")
    .replace(USER_OR_CHANNEL, "")
    .replace(RAW_URL, "")
    .replace(BARE_DOMAIN, "")
    .replace(PLAIN_MASS_MENTION, "$1");
  const out = tidyWhitespace(escapeText(stripped));
  if (out.length <= MAX_ANSWER_CHARS) return out;
  // Cut, then drop a half-written entity such as "&am" and trailing space.
  const cut = out
    .slice(0, MAX_ANSWER_CHARS - 1)
    .replace(/&[a-z]*$/, "")
    .trimEnd();
  return `${cut}…`;
}

// Turns a member's Slack message into plain question text: drops user and
// special mentions, keeps channel names and link labels, unescapes entities.
export function cleanQuestion(text: string): string {
  return text
    .replace(/<@[^>]*>/g, "")
    .replace(/<#[^|>]*\|([^>]*)>/g, "#$1")
    .replace(/<#[^>]*>/g, "")
    .replace(SPECIAL_MENTION, "")
    .replace(/<((?:https?|mailto):[^|>]*)(?:\|([^>]*))?>/gi, (_m, url: string, label?: string) => label ?? url)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// A salted HMAC of the Slack user id. This is the only form of a member's
// identity that leaves the Worker (Resourcus logs and rate limits).
export async function hashUserId(userId: string, salt: string): Promise<string> {
  if (!salt) throw new Error("USER_KEY_SALT is missing; refusing to hash without a salt");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(userId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
