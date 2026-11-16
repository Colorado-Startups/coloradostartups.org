// The home page's "Pick your door" band (step P4): what each door shows.
// Pure: no DOM, no network, no clock. WelcomeDesk.astro (compact) renders it,
// site/test/unit/home/doors.test.ts checks it.
//
// Every choice comes from data, never from a list typed here:
//   door label    routes.yaml `door` (the route's full label when missing)
//   Slack thread  routes.yaml `slack_thread`, a day in threads.yaml
//   resources     routes.yaml `picks_stage`, when topPicks() has picks for it;
//                 otherwise Startup Resources itself
//
// The home page caps each band at 60 visible words, counting what is behind
// closed doors too (site/test/dom/home/home-budget.test.ts). So a door shows
// two short rows, and the band shows the next event once for every door.

import { type Stage, type ThreadOpener, type VisitorKind, WAYS_IN, type WelcomeRoute } from "@cs/shared";

import { STAGE_LABELS } from "../../components/canvas/labels";
import type { StagePicks } from "../../components/canvas/top-picks";

type Day = ThreadOpener["day"];

/** The weekday each thread day is posted on. */
export const DAY_NAMES: Record<Day, string> = { mon: "Monday", wed: "Wednesday", fri: "Friday" };

/** The thread a door starts in when routes.yaml names none: the Monday Welcome. */
export const DEFAULT_THREAD: Day = "mon";

export interface DoorPlan {
  kind: VisitorKind;
  /** The door's short label. */
  label: string;
  slack: {
    day: Day;
    /** "Monday": the row reads "Slack, Monday". */
    dayName: string;
    /** The thread's title in threads.yaml, such as "Monday Welcome". */
    title: string;
  };
  resources: {
    /** The stage whose picks the link opens, or null for the whole directory. */
    stage: Stage | null;
    href: string;
    /** Link text: "Idea picks" or "Startup Resources". */
    text: string;
  };
}

/** The anchor of a stage's picks on Startup Resources (StartHere.astro). */
export const picksHref = (stage: Stage) => `${WAYS_IN.canvas}#start-${stage}`;

/**
 * What one door shows. `threads` is threads.yaml, `picks` is topPicks() of
 * the active resources. A stage with no picks (every card sells to founders)
 * falls back to Startup Resources, so a door never links an empty list.
 */
export function doorPlan(route: WelcomeRoute, threads: readonly ThreadOpener[], picks: readonly StagePicks[]): DoorPlan {
  const titleOf = (d: Day) => threads.find((t) => t.day === d)?.title;
  const day: Day = route.slack_thread && titleOf(route.slack_thread) ? route.slack_thread : DEFAULT_THREAD;
  const wanted = route.picks_stage;
  const stage = wanted && (picks.find((p) => p.stage === wanted)?.picks.length ?? 0) > 0 ? wanted : null;
  return {
    kind: route.id,
    label: route.door ?? route.label,
    slack: { day, dayName: DAY_NAMES[day], title: titleOf(day) ?? "" },
    resources: stage
      ? { stage, href: picksHref(stage), text: `${STAGE_LABELS[stage]} picks` }
      : { stage: null, href: WAYS_IN.canvas, text: "Startup Resources" },
  };
}

// Words as site/test/dom/home/home-budget.test.ts counts them.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;

/** Event titles on the band keep at most this many words. */
export const EVENT_TITLE_WORDS = 9;

/**
 * A title cut to `max` words, with an ellipsis when cut. Keeps the band
 * inside its word cap whatever the calendar holds; the event's own page
 * carries the full title.
 */
export function clampWords(text: string, max = EVENT_TITLE_WORDS): string {
  const words = [...text.matchAll(WORD)];
  if (words.length <= max) return text;
  const last = words[max - 1]!;
  return `${text.slice(0, last.index! + last[0].length).replace(/[\s,.:;&-]+$/u, "")}…`;
}
