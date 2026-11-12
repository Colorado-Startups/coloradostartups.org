// Reads the content collections into feed entries. Owner: L9. The pure
// mapping lives in feed.ts; this file only touches astro:content.
//
// What goes in the feed (lane file L9, "emit dispatches now, and resources and
// editions when present"):
//   - every dispatch, at /dispatches/<id>/
//   - every Leaderboard edition, dated by `published`, at /leaderboard/#<id>
//   - active resources added after the Canvas import (source "suggestion" or
//     "cs") that carry an `added` date, dated by it, at
//     /ecosystem-canvas/#r-<id> (resourceEntries() in feed.ts). The canvas-2026
//     import is the starting map, not news: its records would bury the
//     dispatches under one item per resource.
import { getCollection, type CollectionEntry } from "astro:content";

import { calendarDate, type FeedEntry, resourceEntries, toPlainText } from "./feed";

export type Dispatch = CollectionEntry<"dispatches">;

/** Dispatches, newest first, then by id. */
export async function dispatchesNewestFirst(): Promise<Dispatch[]> {
  return (await getCollection("dispatches")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id),
  );
}

export function dispatchPath(entry: Pick<Dispatch, "id">): string {
  return `/dispatches/${entry.id}/`;
}

export async function feedEntries(): Promise<FeedEntry[]> {
  const dispatches: FeedEntry[] = (await getCollection("dispatches")).map((d) => ({
    kind: "dispatch",
    path: dispatchPath(d),
    title: d.data.title,
    summary: d.data.summary,
    text: toPlainText(d.body ?? d.data.summary),
    date: calendarDate(d.data.date),
    tags: d.data.tags,
  }));

  const editions: FeedEntry[] = (await getCollection("editions")).map(({ data: e }) => ({
    kind: "edition",
    path: `/leaderboard/#${e.id}`,
    title: e.title,
    summary: e.summary,
    text: e.summary,
    date: e.published,
    tags: ["leaderboard", e.kind],
  }));

  const resources = resourceEntries((await getCollection("resources")).map(({ data }) => data));

  return [...dispatches, ...editions, ...resources];
}
