// Turns library copy into a Slack message. Library text is approved copy, but
// it is still escaped, and every block uses verbatim mrkdwn so Slack does no
// auto-linking or mention parsing of its own. The only links are the ones
// built here from site paths.

import type { SlackMessageCopy } from "./library";

// Escapes &, < and > the way Slack requires, so text cannot form a link or a
// mention.
export function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A Slack link to a page on the site, with its label escaped.
export function siteLink(origin: string, path: string, label: string): string {
  return `<${origin}${path}|${escapeText(label)}>`;
}

// A mrkdwn text object with verbatim on, so Slack adds no links of its own.
export function mrkdwn(text: string) {
  return { type: "mrkdwn", text, verbatim: true } as const;
}

// The context block that discloses Communitas as an AI agent, under every
// message it posts.
export function disclosureBlock(disclosure: string) {
  return { type: "context", elements: [mrkdwn(escapeText(disclosure))] } as const;
}

export interface RenderedMessage {
  text: string;
  blocks: unknown[];
}

// Renders library copy (paragraphs, then a bullet list of site links) as Slack
// text and blocks, with the AI disclosure last.
export function renderCopy(copy: SlackMessageCopy, origin: string, disclosure: string): RenderedMessage {
  const paragraphs = copy.lines.map(escapeText);
  const links = copy.links.map((l) => `• ${siteLink(origin, l.path, l.label)}`).join("\n");
  const body = links ? [...paragraphs, links].join("\n\n") : paragraphs.join("\n\n");
  return {
    text: `${body}\n\n_${escapeText(disclosure)}_`,
    blocks: [{ type: "section", text: mrkdwn(body) }, disclosureBlock(disclosure)],
  };
}
