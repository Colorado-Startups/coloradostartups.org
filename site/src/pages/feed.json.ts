// GET /feed.json: JSON Feed 1.1 plus `_cs.kind` (FeedSchema). Owner: L9.
// Publicus's drafting pipeline consumes it, so changes are additive only.
// BaseLayout links it as the site's alternate feed on every page.
import type { APIContext } from "astro";

import { feedEntries } from "../components/dispatches/collect";
import { buildFeed } from "../components/dispatches/feed";

export async function GET({ site }: APIContext) {
  const feed = buildFeed(await feedEntries(), site!);
  return new Response(JSON.stringify(feed, null, 2), {
    headers: { "Content-Type": "application/feed+json; charset=utf-8" },
  });
}
