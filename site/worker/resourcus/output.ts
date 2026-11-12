// Everything the server does to model text before anyone sees it.
//
// Model output is untrusted. The UI renders it with textContent, Slack posts it
// with link_names off, and this file is the third wall:
//   - citations: only ids the server retrieved survive; the rest are dropped
//   - links: URLs, bare domains, email addresses and phone numbers are removed,
//     so an injected link never reaches a visitor (cards carry our own links)
//   - mentions: Slack control sequences and @-mentions are neutralized
//   - voice: markdown is stripped and em or en dashes become commas
//   - leaks: an answer that quotes the system prompt is refused outright

import { ASK_LIMITS } from "@cs/shared";

import { LEAK_MARKERS } from "./prompt";

// An answer comes back as a history turn, so it must fit AskTurnSchema.
export const MAX_ANSWER_CHARS = ASK_LIMITS.maxTurnChars;

// <think> blocks from reasoning models, closed or left open at the end.
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").replace(/^[\s\S]*?<\/think>/i, "");
}

// Folds the tricks that hide a marker from a plain substring match: NFKC,
// Unicode hyphens and dashes to "-", odd spaces to " ", zero-width
// characters and markdown emphasis removed, whitespace collapsed.
function normalizeForLeak(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// True when text holds any LEAK_MARKERS phrase, compared after folding case,
// Unicode forms, dashes, spaces and markdown emphasis.
export function containsLeak(text: string): boolean {
  const folded = normalizeForLeak(text);
  return LEAK_MARKERS.some((m) => folded.includes(normalizeForLeak(m)));
}

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
// [id] or [id, id]. The lookahead skips markdown links like [name](url).
const CITATION = new RegExp(`\\[\\s*(${SLUG}(?:\\s*,\\s*${SLUG})*)\\s*\\](?!\\()`, "g");

export interface Citations {
  text: string; // the answer with every citation token removed
  cited: string[]; // ids the server retrieved, in order of first mention
  dropped: string[]; // ids the model wrote that the server did not retrieve
}

// Pulls [id] citation tokens out of model text. Ids the server retrieved go in
// `cited`, in order of first mention; any other id goes in `dropped`.
export function extractCitations(raw: string, retrieved: ReadonlySet<string>): Citations {
  const cited: string[] = [];
  const dropped: string[] = [];
  const text = raw.replace(CITATION, (_m, group: string) => {
    for (const id of group.split(",").map((s) => s.trim())) {
      if (retrieved.has(id)) {
        if (!cited.includes(id)) cited.push(id);
      } else if (!dropped.includes(id)) {
        dropped.push(id);
      }
    }
    return "";
  });
  return { text, cited, dropped };
}

const TLDS = "com|org|net|io|co|us|ai|dev|app|info|biz|xyz|me|ly|gg|tv|edu|gov|so|sh|to|link|site|online";

// Order matters: markdown links first (keep the label), then raw URLs, then
// anything that still looks like a host name.
const LINK_PATTERNS: RegExp[] = [
  /!?\[([^\]]{0,200})\]\([^)]{0,500}\)/g, // markdown link or image, label kept below
  /\b(?:https?|ftp|file|javascript|data|vbscript|mailto|tel|sms):[^\s<>"']*/gi,
  /\bwww\.[^\s<>"')\]]+/gi,
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, // email address
  new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?:\\/[^\\s]*)?`, "gi"),
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, // US phone number
];

// Removes every link: markdown links keep their label; URLs, www hosts, email
// addresses, bare domains and US phone numbers go.
export function stripLinks(text: string): string {
  let out = text.replace(LINK_PATTERNS[0]!, "$1");
  for (const re of LINK_PATTERNS.slice(1)) out = out.replace(re, "");
  return out;
}

// Slack reads <!channel>, <!here>, <!everyone>, <@U123>, <#C123> and <url|text>
// as live controls, and HTML-looking tags have no place in plain text. Bare
// @channel, @here and @everyone are removed; any other @word keeps its word.
export function neutralizeMentions(text: string): string {
  return text
    .replace(/<[^<>]{0,300}>/g, "")
    .replace(/(^|[^\w])@(channel|here|everyone)\b/gi, "$1")
    .replace(/(^|[^\w])@(?=\w)/g, "$1");
}

// The voice rules a model can still slip on, enforced server-side so they
// survive a model swap.
export function enforceVoice(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "") // zero-width and bidi controls
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "") // markdown headings
    .replace(/^[ \t]*>[ \t]?/gm, "") // block quotes
    .replace(/^[ \t]*[-*+][ \t]+/gm, "") // bullet markers
    .replace(/\*\*|__/g, "") // bold
    .replace(/\*/g, "") // stray emphasis
    .replace(/`+/g, "") // code ticks and fences
    .replace(/[\u202F\u00A0]/g, " ") // narrow and non-breaking spaces
    .replace(/\u2011/g, "-") // non-breaking hyphen
    .replace(/\s*[\u2014\u2013]\s*/g, ", ") // em or en dash
    .replace(/[ \t]+([.,;:!?])/g, "$1") // space before punctuation
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\(\s*\)/g, "") // parentheses emptied by link stripping
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Cut at the last sentence end that fits, so an answer never stops mid-word.
export function capLength(text: string, max = MAX_ANSWER_CHARS): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"), slice.lastIndexOf("? "));
  // The result must fit `max`: the panel sends answers back as history, and
  // AskTurnSchema caps each turn.
  return end > max / 2 ? slice.slice(0, end + 1) : `${slice.slice(0, max - 3).trimEnd()}...`;
}

// Cleans model text for display: links out, mentions neutralized, voice rules
// enforced, then capped in length.
export function sanitizeAnswer(text: string): string {
  return capLength(enforceVoice(neutralizeMentions(stripLinks(text))));
}
