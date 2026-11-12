// /feed.json, the machine-readable log Publicus drafts from (JSON Feed 1.1
// shape plus a `_cs` extension). L1 builds it at build time. Consumers: the
// LinkedIn project's drafting pipeline. Additive changes only.

import * as z from "zod";

export const FEED_PATH = "/feed.json";

export const FeedItemSchema = z.object({
  id: z.string(),
  url: z.url(),
  title: z.string(),
  content_text: z.string().max(2000),
  date_published: z.iso.datetime({ offset: true }),
  tags: z.array(z.string()).default([]),
  _cs: z.object({
    kind: z.enum(["dispatch", "resource", "edition"]),
  }),
});

export const FeedSchema = z.object({
  version: z.literal("https://jsonfeed.org/version/1.1"),
  title: z.string(),
  home_page_url: z.url(),
  feed_url: z.url(),
  items: z.array(FeedItemSchema),
});
export type Feed = z.infer<typeof FeedSchema>;
