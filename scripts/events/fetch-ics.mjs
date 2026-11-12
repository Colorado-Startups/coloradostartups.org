#!/usr/bin/env node
// Writes data/events/upcoming.json, the next 60 days of the community
// calendar, so /event-calendar/ can list events as HTML that crawlers and AI
// assistants read. The Google Calendar iframe stays below the list for people.
//
//   node scripts/events/fetch-ics.mjs              refresh the snapshot now
//   node scripts/events/fetch-ics.mjs --prebuild   the site's prebuild step: refresh
//                                                  only on Workers Builds (WORKERS_CI=1)
//                                                  or when CS_EVENTS_FETCH=1
//
// The feed URL is fixed: the public ICS address of CALENDAR_ID in
// site/src/components/info/links.ts. Nothing here takes a URL from input
// (brief, hard constraint 12).
//
// Every event's title, location, link and description go through
// 04_tools/cs_site_lint.py first (lib/lint.mjs). An event with any term-rule
// finding, or a prose FAIL in its title or location, stays off the page and
// the log says which rule; the iframe still shows it.
//
// Exit codes, the repo's checker contract:
//   0  snapshot written, or skipped in --prebuild off Workers Builds
//   2  usage error
//   3  could not check: the feed, the parser or the content gate failed.
//      The committed snapshot is left as it was. This fails open for the
//      build and closed for the content: unchecked text never reaches it.
// The prebuild wraps this in `|| true`, so the build never fails here.
//
// Freshness needs a scheduled rebuild. A build only refreshes the list when
// it runs, so production needs a daily Workers Builds deploy hook (see
// scripts/events/README.md).

import { renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readFeed } from "./lib/events.mjs";
import { IcsError } from "./lib/ics.mjs";
import { CouldNotLint, dropReason, lintSources, termRuleIds } from "./lib/lint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const SNAPSHOT_PATH = path.join(ROOT, "data/events/upcoming.json");
export const WINDOW_DAYS = 60;
export const MAX_FEED_BYTES = 16 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const DAY = 86_400_000;

export const EXIT = { OK: 0, USAGE: 2, COULD_NOT_CHECK: 3 };

const USAGE = "usage: node scripts/events/fetch-ics.mjs [--prebuild]";

/** The public ICS address of a Google Calendar. */
export function feedUrl(calendarId) {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
}

/** CALENDAR_ID and CALENDAR_TIMEZONE, from the one place the site keeps them. */
export async function calendarConfig() {
  const links = await import("../../site/src/components/info/links.ts");
  return { id: links.CALENDAR_ID, timeZone: links.CALENDAR_TIMEZONE };
}

class CouldNotFetch extends Error {}

async function download(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/calendar", "user-agent": "coloradostartups.org event list (+https://coloradostartups.org/event-calendar/)" },
    });
  } catch (err) {
    throw new CouldNotFetch(`fetch failed (${err.message})`);
  }
  if (!res.ok) throw new CouldNotFetch(`the feed answered HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/calendar/i.test(type)) throw new CouldNotFetch(`the feed answered ${type || "no content type"}, not text/calendar`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) throw new CouldNotFetch(`the feed is ${declared} bytes, over the ${MAX_FEED_BYTES} byte cap`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new CouldNotFetch(`the feed is over the ${MAX_FEED_BYTES} byte cap`);
  return text;
}

/** YYYY-MM-DD in a time zone, for the content gate's date windows. */
export function dateIn(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Builds the snapshot from feed text: occurrences in the window, minus any
 * source the content gate flags. Throws IcsError or CouldNotLint when it
 * cannot check.
 */
export function buildSnapshot(text, { now, timeZone, source, repoRoot = ROOT, python = "python3" }) {
  const fromMs = now.getTime();
  const toMs = fromMs + WINDOW_DAYS * DAY;
  const { sources, occurrences, notes } = readFeed(text, { fromMs, toMs, timeZone });
  const used = [...new Set(occurrences.map((o) => o.sourceIndex))].sort((a, b) => a - b);
  const findings = lintSources(
    used.map((i) => sources[i]),
    { repoRoot, python, today: dateIn(now, timeZone) },
  );
  const terms = termRuleIds(repoRoot);
  const dropped = [];
  const keep = new Set();
  used.forEach((sourceIndex, i) => {
    const reason = dropReason(findings.get(String(i)) ?? [], terms);
    if (reason) dropped.push({ uid: sources[sourceIndex].uid, title: sources[sourceIndex].title, reason });
    else keep.add(sourceIndex);
  });
  const events = occurrences
    .filter((o) => keep.has(o.sourceIndex))
    .map((o) => {
      const s = sources[o.sourceIndex];
      return {
        id: `${s.uid}#${o.start}`,
        title: s.title,
        start: o.start,
        end: o.end,
        allDay: o.allDay,
        location: s.location,
        url: s.url,
        inPerson: s.inPerson,
      };
    })
    .filter((e) => e.title);
  return {
    snapshot: { source, fetchedAt: now.toISOString(), timeZone, windowDays: WINDOW_DAYS, events },
    dropped,
    notes,
  };
}

/** Writes beside the target, then renames, so a crash never leaves half a file. */
export function writeSnapshot(snapshot, out) {
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(tmp, out);
}

/**
 * Fetches, checks and writes. Returns the exit code; never throws for a
 * feed, parser or gate problem.
 */
export async function refresh({
  fetchImpl = globalThis.fetch,
  now = new Date(),
  out = SNAPSHOT_PATH,
  python = "python3",
  repoRoot = ROOT,
  calendar,
  log = console.log,
} = {}) {
  const keepNote = `Kept ${path.relative(repoRoot, out)} as it was.`;
  try {
    const cal = calendar ?? (await calendarConfig());
    const source = feedUrl(cal.id);
    const text = await download(source, fetchImpl);
    const { snapshot, dropped, notes } = buildSnapshot(text, { now, timeZone: cal.timeZone, source, repoRoot, python });
    for (const n of notes) log(`events: note: ${n.uid}: ${n.reason}`);
    for (const d of dropped) log(`events: left off the page: "${d.title}" (${d.uid}): ${d.reason}`);
    writeSnapshot(snapshot, out);
    log(`events: wrote ${snapshot.events.length} events for the next ${WINDOW_DAYS} days; ${dropped.length} series left off by the content gate.`);
    return EXIT.OK;
  } catch (err) {
    if (err instanceof CouldNotFetch || err instanceof IcsError || err instanceof CouldNotLint) {
      log(`events: could not check: ${err.message}. ${keepNote}`);
    } else {
      log(`events: could not check: ${err?.stack ?? err}. ${keepNote}`);
    }
    return EXIT.COULD_NOT_CHECK;
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const log = deps.log ?? console.log;
  for (const arg of argv) {
    if (arg === "--help") {
      log(USAGE);
      return EXIT.OK;
    }
    if (arg !== "--prebuild") {
      log(`events: unknown option ${arg}. ${USAGE}`);
      return EXIT.USAGE;
    }
  }
  if (argv.includes("--prebuild") && env.WORKERS_CI !== "1" && env.CS_EVENTS_FETCH !== "1") {
    log("events: not on Workers Builds, so this build lists the committed snapshot. Set CS_EVENTS_FETCH=1 to refresh it.");
    return EXIT.OK;
  }
  return refresh({ ...deps, log });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
