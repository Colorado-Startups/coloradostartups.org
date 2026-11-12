// The weekly openers. On Monday, Wednesday and Friday the cron posts one
// opener from the approved library, and nothing else. Each week moves to the
// next opener for that day and starts over at the end of the list.

import type { ThreadOpener } from "@cs/shared";

import { type Deps, errorCode } from "./deps";
import { disclosureBlock, escapeText, mrkdwn } from "./format";
import { isPaused } from "./pause";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS: Record<number, ThreadOpener["day"]> = { 1: "mon", 3: "wed", 5: "fri" };

// Weeks counted from a Monday. Day 0 of the epoch was a Thursday, so +3 lines
// each Monday up with the start of a new week.
function weekNumber(time: number): number {
  return Math.floor((Math.floor(time / DAY_MS) + 3) / 7);
}

// The thread opener for this UTC weekday, rotated by week number. Undefined
// when the library has none for the day.
export function pickOpener(threads: readonly ThreadOpener[], time: number): ThreadOpener | undefined {
  const day = DAYS[new Date(time).getUTCDay()];
  if (!day) return undefined;
  const choices = threads.filter((t) => t.day === day);
  if (choices.length === 0) return undefined;
  return choices[weekNumber(time) % choices.length];
}

// The cron handler: posts the day's thread opener, with the AI disclosure, to
// the threads channel. Does nothing while paused or with no opener.
export async function handleScheduled(
  time: number,
  env: { COMMUNITAS_PAUSED?: string },
  deps: Deps,
): Promise<void> {
  if (isPaused(env)) return;
  const opener = pickOpener(deps.library.threads, time);
  if (!opener) return;
  if (!deps.threadsChannel) {
    deps.log("threads_channel_unset", { opener: opener.id });
    return;
  }
  const text = `*${escapeText(opener.title)}*\n${escapeText(opener.body)}`;
  try {
    await deps.slack.postMessage({
      channel: deps.threadsChannel,
      text,
      blocks: [{ type: "section", text: mrkdwn(text) }, disclosureBlock(deps.library.disclosure.communitas)],
    });
    deps.log("opener_posted", { opener: opener.id });
  } catch (err) {
    deps.log("opener_failed", { opener: opener.id, error: errorCode(err) });
  }
}
