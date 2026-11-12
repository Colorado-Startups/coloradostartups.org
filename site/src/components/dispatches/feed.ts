// /feed.json and /rss.xml from plain data. Owner: L9.
//
// Pure functions, no astro:content, so unit tests run them in Node.
// collect.ts reads the collections and calls these.
//
// feed.json follows FeedSchema (JSON Feed 1.1 plus `_cs.kind`). Publicus's
// drafting pipeline in the LinkedIn project consumes it, so every change here
// is additive: new optional fields only, never a rename or a removal.
//
// Dates. Dispatches, editions and resources carry calendar dates. A feed needs
// an instant, so each date becomes midnight in Denver, with the offset in
// force on that day (MDT -06:00 or MST -07:00).
import { type Feed, FEED_PATH, type Resource } from "@cs/shared";

/** A FeedSchema item plus JSON Feed 1.1's optional `summary` (additive). */
type FeedItem = Feed["items"][number] & { summary?: string };
type FeedKind = FeedItem["_cs"]["kind"];

/** FeedSchema plus optional JSON Feed 1.1 top-level fields (additive). */
export interface CsFeed extends Feed {
  description: string;
  language: string;
  icon: string;
  favicon: string;
  authors: { name: string; url: string }[];
  items: FeedItem[];
}

const FEED_TITLE = "Colorado Startups dispatches";
const FEED_DESCRIPTION = "News from Colorado Startups, a community of founders building companies in Colorado.";
const RSS_PATH = "/rss.xml";
export const CONTENT_TEXT_MAX = 2000;

/** One entry before it becomes a feed item. `date` is a calendar date, YYYY-MM-DD. */
export interface FeedEntry {
  kind: FeedKind;
  /** Site-relative path with an optional #fragment, e.g. "/dispatches/x/". */
  path: string;
  title: string;
  summary?: string;
  /** Plain text, not Markdown: run Markdown through toPlainText() first. */
  text: string;
  date: string;
  tags: string[];
}

/**
 * The feed entries for Startup Resources: active records added after the
 * Canvas import (source "suggestion" or "cs"), dated by `added`. A record
 * without `added` stays out rather than falling back to last_checked, which
 * moves every time someone re-checks a link and would re-date an old record.
 * The canvas-2026 import is the starting map, not news.
 */
export function resourceEntries(resources: readonly Resource[]): FeedEntry[] {
  return resources.flatMap((r): FeedEntry[] =>
    r.status === "active" && r.source !== "canvas-2026" && r.added
      ? [
          {
            kind: "resource",
            path: `/ecosystem-canvas/#r-${r.id}`,
            title: r.name,
            summary: r.description,
            text: `${r.name}. ${r.description}`,
            date: r.added,
            tags: ["startup-resources", r.stage, r.type, ...r.tags],
          },
        ]
      : [],
  );
}

const DENVER_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", timeZoneName: "longOffset" });

/** "2026-10-06" becomes "2026-10-06T00:00:00-06:00": midnight in Denver that day. */
export function denverMidnight(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`not a calendar date: ${date}`);
  // 07:00 UTC is midnight MST or 1 a.m. MDT: before the 2 a.m. switch on both
  // change days, so it reads the offset that held at local midnight.
  const probe = new Date(`${date}T07:00:00Z`);
  const name = DENVER_OFFSET.formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = name === "GMT" ? "+00:00" : name.slice(3);
  return `${date}T00:00:00${offset}`;
}

/** A Date's calendar day in UTC. Astro's z.coerce.date() reads "2026-10-06" as UTC midnight. */
export function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A link target or link text reduced for comparison: no scheme, no trailing slash, lower case. */
function normalizeAddress(value: string): string {
  return value
    .trim()
    .replace(/^(?:https?:\/\/|mailto:)/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * Markdown to plain text for content_text. Handles what dispatches use:
 * headings, emphasis, inline code, images, links and block quotes. A link
 * whose text is its own address keeps the text only; any other link keeps
 * its address in parentheses, so [here](https://x.com/where) never loses it.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, href: string) =>
      normalizeAddress(text) === normalizeAddress(href) ? text : `${text} (${href})`,
    )
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts text to at most `max` characters at a word boundary, ending with an ellipsis when cut. */
export function clip(text: string, max = CONTENT_TEXT_MAX): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const cut = room.lastIndexOf(" ");
  return `${(cut > max / 2 ? room.slice(0, cut) : room).trimEnd()}…`;
}

function toFeedItem(entry: FeedEntry, site: URL): FeedItem {
  const url = new URL(entry.path, site).toString();
  return {
    // The URL is stable for each entry, so it is also the id (JSON Feed 1.1).
    id: url,
    url,
    title: entry.title,
    content_text: clip(entry.text),
    ...(entry.summary && { summary: entry.summary }),
    date_published: denverMidnight(entry.date),
    tags: entry.tags,
    _cs: { kind: entry.kind },
  };
}

/** Newest first; on the same day dispatches lead, then editions, then resources. */
const KIND_ORDER: Record<FeedKind, number> = { dispatch: 0, edition: 1, resource: 2 };

export function buildFeed(entries: readonly FeedEntry[], site: URL): CsFeed {
  const items = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path))
    .map((e) => toFeedItem(e, site));
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: FEED_TITLE,
    home_page_url: new URL("/", site).toString(),
    feed_url: new URL(FEED_PATH, site).toString(),
    description: FEED_DESCRIPTION,
    language: "en-US",
    icon: new URL("/brand/cs-logo-240.png", site).toString(),
    favicon: new URL("/favicon.ico", site).toString(),
    authors: [{ name: "Colorado Startups", url: new URL("/", site).toString() }],
    items,
  };
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function xmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch);
}

/** RFC 822 date for RSS 2.0, e.g. "Tue, 06 Oct 2026 06:00:00 GMT". */
export function rfc822(isoWithOffset: string): string {
  return new Date(isoWithOffset).toUTCString();
}

/** RSS 2.0 with an atom:link to itself, from the same items as feed.json. */
export function buildRss(feed: CsFeed, site: URL): string {
  const self = new URL(RSS_PATH, site).toString();
  const items = feed.items
    .map((item) => {
      const description = item.summary ?? item.content_text;
      return [
        "    <item>",
        `      <title>${xmlEscape(item.title)}</title>`,
        `      <link>${xmlEscape(item.url)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(item.id)}</guid>`,
        `      <pubDate>${rfc822(item.date_published)}</pubDate>`,
        `      <description>${xmlEscape(description)}</description>`,
        ...item.tags.map((tag) => `      <category>${xmlEscape(tag)}</category>`),
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  const lastBuild = feed.items[0] ? `\n    <lastBuildDate>${rfc822(feed.items[0].date_published)}</lastBuildDate>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(FEED_TITLE)}</title>
    <link>${xmlEscape(new URL("/dispatches/", site).toString())}</link>
    <description>${xmlEscape(FEED_DESCRIPTION)}</description>
    <language>en-us</language>
    <atom:link href="${xmlEscape(self)}" rel="self" type="application/rss+xml" />${lastBuild}
${items}
  </channel>
</rss>
`;
}
