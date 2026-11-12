// The welcome desk's routing: who the visitor says they are, and which ways
// into the community Communitas shows them. Runs at build time only; the desk
// is static HTML, so there is no API and no model call.
//
// Two functions on purpose:
//   routeNewcomer()  Paul's judgment: which steps, in what order.
//   deskSteps()      the hard rules, applied to whatever routeNewcomer returns.
// WelcomeDesk.astro renders deskSteps(), so no body Paul writes can break the
// rules. site/test/unit/l5/route.test.ts and site/test/unit/l10/ check both.

import {
  type Stage,
  type VisitorKind,
  WAYS_IN,
  type WayInKind,
  type WelcomeRoute,
} from "@cs/shared";

import { STAGE_LABELS } from "../../components/canvas/labels";

/** One next step on the desk. */
export interface DeskStep {
  kind: WayInKind;
  /** WAYS_IN[kind]; a Canvas step may add its stage as a #fragment. */
  href: string;
  /** Link text. It says exactly where the link goes. */
  label: string;
  /** Why this step fits the visitor, from data/communitas/routes.yaml. */
  note: string;
}

/**
 * Communitas's voice in data/team/dwarves.yaml: "at most three next steps,
 * never a long list". Founder doors use the third for the founders forum.
 */
export const MAX_STEPS = 3;

/**
 * The founder doors (decision 46). Only these may show the founders forum,
 * because the forum is for founders only (decision 49).
 */
export const FOUNDER_KINDS: readonly VisitorKind[] = ["idea", "building", "hiring"];

export const WAY_LABELS: Record<WayInKind, string> = {
  slack: "Join the Slack",
  "linkedin-group": "Join the LinkedIn Group",
  "linkedin-page": "Follow the LinkedIn Page",
  newsletter: "Get the Startupers newsletter",
  events: "See upcoming events",
  // Decision 46 retitles the Ecosystem Canvas "Startup Resources".
  canvas: "Open Startup Resources",
  leaderboard: "See the Leaderboard",
  discourse: "Read about the founders forum",
  // The guides' own titles, so the link says which page it opens (card #150).
  "guide-start": "Read how to start a company in Colorado",
  "guide-accelerators": "See accelerators and incubators in Colorado",
};

/** Turns one routes.yaml recommendation into a desk step. */
function toStep(rec: WelcomeRoute["recommends"][number]): DeskStep {
  const kind = rec.kind;
  if (kind === "canvas" && rec.canvas_stage) {
    const stage: Stage = rec.canvas_stage;
    return {
      kind,
      href: `${WAYS_IN.canvas}#${stage}`,
      label: `Open the ${STAGE_LABELS[stage]} stage of Startup Resources`,
      note: rec.note,
    };
  }
  return { kind, href: WAYS_IN[kind], label: WAY_LABELS[kind], note: rec.note };
}

/**
 * Which ways in Communitas recommends to one visitor.
 *
 * Input: the visitor's answer ("idea", "building", "talent" and so on) and
 * every route from data/communitas/routes.yaml. Output: the steps to show, in
 * order. Use toStep() to turn a recommendation into a step.
 *
 * The choices this function makes:
 *   - Order. routes.yaml lists recommendations in an order; keep it, or rank
 *     them (for example, the Slack first for everyone who is building).
 *   - How many. deskSteps() keeps at most MAX_STEPS. Fewer is fine.
 *   - A visitor with no route. Return nothing, or a default such as the
 *     "curious" route.
 *
 * What it cannot change: deskSteps() drops the Leaderboard for investors
 * (decision 17), shows the founders forum on founder doors only, and caps the
 * list. Steps must come from routes.yaml so every note is reviewed copy.
 */
export function routeNewcomer(visitor: VisitorKind, routes: readonly WelcomeRoute[]): DeskStep[] {
  // Paul's choice, on the Project 2 card "routeNewcomer: Paul's order, count and
  // fallback for the welcome desk": replace this default in 5 to 10 lines. The default keeps the routes.yaml order but
  // moves the founders forum last, because it is not open yet and the steps a
  // founder can take today matter more. Then it keeps the first MAX_STEPS,
  // so a long route drops the forum before it drops a live step. A visitor
  // with no route sees nothing.
  const route = routes.find((r) => r.id === visitor);
  const steps = (route?.recommends ?? []).map(toStep);
  const later = (s: DeskStep) => (s.kind === "discourse" ? 1 : 0);
  return steps.sort((a, b) => later(a) - later(b)).slice(0, MAX_STEPS);
}

/** True when a step may appear behind this visitor's door. */
function allowedFor(visitor: VisitorKind) {
  const founder = FOUNDER_KINDS.includes(visitor);
  return (s: { kind: WayInKind }) =>
    !(visitor === "investing" && s.kind === "leaderboard") && (founder || s.kind !== "discourse");
}

/** The steps the desk renders: routeNewcomer's choice with the hard rules applied. */
export function deskSteps(visitor: VisitorKind, routes: readonly WelcomeRoute[]): DeskStep[] {
  // Applied before and after routeNewcomer: a forbidden step never reaches it,
  // and nothing it adds can slip through.
  const allowed = allowedFor(visitor);
  const cleaned = routes.map((r) => (r.id === visitor ? { ...r, recommends: r.recommends.filter(allowed) } : r));
  return routeNewcomer(visitor, cleaned)
    .filter(allowed)
    .filter((s) => s.href === WAYS_IN[s.kind] || (s.kind === "canvas" && s.href.startsWith(`${WAYS_IN.canvas}#`)))
    .slice(0, MAX_STEPS);
}
