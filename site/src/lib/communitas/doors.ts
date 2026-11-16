// The home page's "Pick your door" band (step P4): what each door shows.
// Pure: no DOM, no network, no clock. WelcomeDesk.astro (compact) renders it,
// site/test/unit/home/doors.test.ts checks it.
//
// Every choice comes from data, never from a list typed here:
//   door label    routes.yaml `door` (the route's full label when missing)
//   Slack thread  routes.yaml `slack_thread`, a day in threads.yaml
//   resources     routes.yaml `picks_stage`: up to three of topPicks() for
//                 that stage, then a link to all of them; with no stage, or
//                 a stage with no picks, a link to Startup Resources
//
// Words behind a closed door do not count toward the band's 60, but each
// door's body holds at most DOOR_BODY_WORDS (site/test/dom/home/
// home-budget.test.ts). doorPlan() drops picks from the end until it fits.

import { type Stage, type ThreadOpener, type VisitorKind, WAYS_IN, type WelcomeRoute } from "@cs/shared";

import { STAGE_LABELS } from "../../components/canvas/labels";
import { isCommercial, type StagePicks } from "../../components/canvas/top-picks";
import { SLACK_JOIN } from "./join";

type Day = ThreadOpener["day"];

/** The weekday each thread day is posted on. */
export const DAY_NAMES: Record<Day, string> = { mon: "Monday", wed: "Wednesday", fri: "Friday" };

/** The thread a door starts in when routes.yaml names none: the Monday Welcome. */
export const DEFAULT_THREAD: Day = "mon";

/** The most words an open door's body may hold. */
export const DOOR_BODY_WORDS = 30;

export interface DoorLink {
  href: string;
  text: string;
}

export interface DoorPlan {
  kind: VisitorKind;
  /** The door's short label. */
  label: string;
  slack: {
    day: Day;
    dayName: string;
    /** The thread's title in threads.yaml, such as "Monday Welcome". */
    title: string;
    /** "Monday Welcome thread, weekly in the Slack." */
    line: string;
    /** Join the Slack, described by the hero's note (lib/communitas/join.ts). */
    join: DoorLink & { describedBy: string };
  };
  resources: {
    /** The stage whose picks the door names, or null for the whole directory. */
    stage: Stage | null;
    /** Named picks, each linking its row on Startup Resources (#r-<id>). */
    picks: (DoorLink & { id: string })[];
    /** "All Idea picks" or "Startup Resources". */
    all: DoorLink;
  };
}

/** The anchor of a stage's picks on Startup Resources (StartHere.astro). */
export const picksHref = (stage: Stage) => `${WAYS_IN.canvas}#start-${stage}`;

/** The anchor of one resource's row on Startup Resources (ResourceRow.astro). */
export const resourceHref = (id: string) => `${WAYS_IN.canvas}#r-${id}`;

// Words as site/test/dom/home/home-budget.test.ts counts them.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
export const countWords = (text: string) => [...text.matchAll(WORD)].length;

/** Every word an open door's body shows, in order. */
export function bodyText(plan: DoorPlan): string[] {
  return [plan.slack.line, plan.slack.join.text, ...plan.resources.picks.map((p) => p.text), plan.resources.all.text];
}

/**
 * What one door shows. `threads` is threads.yaml, `picks` is topPicks() of
 * the active resources. A commercial card is never named, even if one slips
 * into `picks`.
 */
export function doorPlan(route: WelcomeRoute, threads: readonly ThreadOpener[], picks: readonly StagePicks[]): DoorPlan {
  const titleOf = (d: Day) => threads.find((t) => t.day === d)?.title;
  const day: Day = route.slack_thread && titleOf(route.slack_thread) ? route.slack_thread : DEFAULT_THREAD;
  const title = titleOf(day) ?? DAY_NAMES[day];
  const wanted = route.picks_stage;
  const named = wanted
    ? (picks.find((p) => p.stage === wanted)?.picks ?? [])
        .filter((p) => !isCommercial(p.card))
        .map((p) => ({ id: p.card.id, href: resourceHref(p.card.id), text: p.card.name }))
    : [];
  const stage = wanted && named.length > 0 ? wanted : null;

  const plan: DoorPlan = {
    kind: route.id,
    label: route.door ?? route.label,
    slack: {
      day,
      dayName: DAY_NAMES[day],
      title,
      line: `${title} thread, weekly in the Slack.`,
      join: { href: SLACK_JOIN.href, text: SLACK_JOIN.label, describedBy: SLACK_JOIN.noteId },
    },
    resources: stage
      ? { stage, picks: named.slice(0, 3), all: { href: picksHref(stage), text: `All ${STAGE_LABELS[stage]} picks` } }
      : { stage: null, picks: [], all: { href: WAYS_IN.canvas, text: "Startup Resources" } },
  };
  while (plan.resources.picks.length > 0 && countWords(bodyText(plan).join(" ")) > DOOR_BODY_WORDS) {
    plan.resources.picks.pop();
  }
  return plan;
}

/** Event titles on the band keep at most this many words. */
export const EVENT_TITLE_WORDS = 9;

/**
 * A title cut to `max` words, with an ellipsis when cut. Keeps the band
 * inside its word cap whatever the calendar holds. The link carries the full
 * title for assistive tech (PickDoor.astro).
 */
export function clampWords(text: string, max = EVENT_TITLE_WORDS): string {
  const words = [...text.matchAll(WORD)];
  if (words.length <= max) return text;
  const last = words[max - 1]!;
  return `${text.slice(0, last.index! + last[0].length).replace(/[\s,.:;&-]+$/u, "")}…`;
}
