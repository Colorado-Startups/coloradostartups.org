// GET /rss.xml: RSS 2.0 with the same items as /feed.json. Owner: L9.
import type { APIContext } from "astro";

import { feedEntries } from "../components/dispatches/collect";
import { buildFeed, buildRss } from "../components/dispatches/feed";

export async function GET({ site }: APIContext) {
  const base = site!;
  const xml = buildRss(buildFeed(await feedEntries(), base), base);
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
