// Step P4: doorPlan(), what each "Pick your door" door shows on home, and
// clampWords(), which keeps the band's event title inside its word cap.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ResourceCard,
  ThreadOpenerSchema,
  VISITOR_KINDS,
  WAYS_IN,
  type WelcomeRoute,
  WelcomeRouteSchema,
} from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type { StagePicks } from "../../../src/components/canvas/top-picks";
import {
  bodyText,
  clampWords,
  countWords,
  DOOR_BODY_WORDS,
  doorPlan,
  EVENT_TITLE_WORDS,
  picksHref,
  resourceHref,
} from "../../../src/lib/communitas/doors";
import { SLACK_JOIN } from "../../../src/lib/communitas/join";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const routes = (parse(read("data/communitas/routes.yaml")) as unknown[]).map((r) => WelcomeRouteSchema.parse(r));
const threads = (parse(read("data/communitas/threads.yaml")) as unknown[]).map((t) => ThreadOpenerSchema.parse(t));

const card = (id: string, name = id, type: ResourceCard["type"] = "education", substage = "educate"): ResourceCard =>
  ({ id, name, type, substage }) as ResourceCard;
const stagePicks = (cards: Partial<Record<StagePicks["stage"], ResourceCard[]>>): StagePicks[] =>
  (["idea", "launch", "growth", "support"] as const).map((stage) => ({
    stage,
    picks: (cards[stage] ?? []).map((c) => ({ card: c, reason: "first-need" as const })),
  }));
const allPicks = stagePicks({
  idea: [card("idea-1")],
  launch: [card("launch-1")],
  growth: [card("growth-1")],
  support: [card("support-1")],
});
const route = (over: Partial<WelcomeRoute>): WelcomeRoute => ({
  id: "idea",
  label: "I have an idea for a company",
  recommends: [{ kind: "slack", note: "Hello." }],
  ...over,
});

describe("doorPlan", () => {
  it("gives every visitor kind in routes.yaml a door with a short label", () => {
    expect(routes.map((r) => r.id)).toEqual([...VISITOR_KINDS]);
    for (const r of routes) {
      const plan = doorPlan(r, threads, allPicks);
      expect(plan.label, r.id).toBe(r.door);
      expect(plan.label.length, r.id).toBeLessThanOrEqual(20);
    }
  });

  it("maps each door to its Slack thread and picks, as routes.yaml says", () => {
    const table = Object.fromEntries(
      routes.map((r) => {
        const p = doorPlan(r, threads, allPicks);
        return [r.id, `${p.label} | ${p.slack.line} | ${p.resources.all.text}`];
      }),
    );
    expect(table).toEqual({
      idea: "Idea | Monday Welcome thread, weekly in the Slack. | All Idea picks",
      building: "Building | Asks and Offers thread, weekly in the Slack. | All Launch picks",
      hiring: "Hiring | Asks and Offers thread, weekly in the Slack. | All Growth picks",
      talent: "Job seeker | Asks and Offers thread, weekly in the Slack. | Startup Resources",
      investing: "Investor or lender | Monday Welcome thread, weekly in the Slack. | Startup Resources",
      "service-provider": "Services | Asks and Offers thread, weekly in the Slack. | Startup Resources",
      student: "Student | Monday Welcome thread, weekly in the Slack. | All Idea picks",
      curious: "Curious | Monday Welcome thread, weekly in the Slack. | Startup Resources",
    });
  });

  it("gives every door a Join the Slack link through WAYS_IN, described by the hero's Google Form note", () => {
    for (const r of routes) {
      expect(doorPlan(r, threads, allPicks).slack.join, r.id).toEqual({
        href: WAYS_IN.slack,
        text: "Join the Slack",
        describedBy: SLACK_JOIN.noteId,
      });
    }
  });

  it("names up to three picks, each linking its row on Startup Resources, then all of the stage's picks", () => {
    const five = stagePicks({ launch: ["a", "b", "c", "d", "e"].map((id) => card(id, `Program ${id}`)) });
    const plan = doorPlan(route({ picks_stage: "launch" }), threads, five);
    expect(plan.resources.picks).toEqual([
      { id: "a", href: `${WAYS_IN.canvas}#r-a`, text: "Program a" },
      { id: "b", href: `${WAYS_IN.canvas}#r-b`, text: "Program b" },
      { id: "c", href: `${WAYS_IN.canvas}#r-c`, text: "Program c" },
    ]);
    expect(plan.resources.all).toEqual({ href: `${WAYS_IN.canvas}#start-launch`, text: "All Launch picks" });
    expect(picksHref("idea")).toBe(`${WAYS_IN.canvas}#start-idea`);
    expect(resourceHref("x")).toBe(`${WAYS_IN.canvas}#r-x`);
  });

  it("never names a commercial card, even if one reaches it", () => {
    const mixed = stagePicks({
      idea: [card("firm", "A Firm", "service-provider"), card("fund", "A Fund", "investor"), card("subs", "Subs", "event", "service-providers"), card("ok")],
    });
    expect(doorPlan(route({ picks_stage: "idea" }), threads, mixed).resources.picks.map((p) => p.id)).toEqual(["ok"]);
  });

  it(`keeps each door's body to ${DOOR_BODY_WORDS} words, dropping picks from the end`, () => {
    const long = (id: string) => card(id, `The ${id} Very Long Program Name For Colorado Founders Everywhere`);
    const plan = doorPlan(route({ picks_stage: "idea" }), threads, stagePicks({ idea: [long("one"), long("two"), long("three")] }));
    expect(countWords(bodyText(plan).join(" "))).toBeLessThanOrEqual(DOOR_BODY_WORDS);
    expect(plan.resources.picks.map((p) => p.id)).toEqual(["one"]);
    for (const r of routes) expect(countWords(bodyText(doorPlan(r, threads, allPicks)).join(" ")), r.id).toBeLessThanOrEqual(DOOR_BODY_WORDS);
  });

  it("falls back to Startup Resources when the stage has no picks or the door names none", () => {
    const empty = stagePicks({});
    for (const r of [route({ picks_stage: "growth" }), route({})]) {
      expect(doorPlan(r, threads, empty).resources).toEqual({
        stage: null,
        picks: [],
        all: { href: WAYS_IN.canvas, text: "Startup Resources" },
      });
    }
  });

  it("never gives the investor or service-provider door a stage, since picks are for founders", () => {
    for (const id of ["investing", "service-provider"] as const) {
      const plan = doorPlan(routes.find((r) => r.id === id)!, threads, allPicks);
      expect(plan.resources.stage, id).toBeNull();
      expect(plan.resources.picks, id).toEqual([]);
    }
  });

  it("starts in the Monday Welcome when the door names no thread, or one threads.yaml lacks", () => {
    expect(doorPlan(route({}), threads, allPicks).slack.day).toBe("mon");
    const noFriday = threads.filter((t) => t.day !== "fri");
    expect(doorPlan(route({ slack_thread: "fri" }), noFriday, allPicks).slack.day).toBe("mon");
    expect(doorPlan(route({ slack_thread: "wed" }), threads, allPicks).slack).toMatchObject({
      day: "wed",
      dayName: "Wednesday",
      title: "Asks and Offers",
    });
  });

  it("uses the full label when a route has no short one", () => {
    expect(doorPlan(route({}), threads, allPicks).label).toBe("I have an idea for a company");
  });
});

describe("clampWords", () => {
  it("keeps a short title as it is", () => {
    expect(clampWords("1 Million Cups Denver")).toBe("1 Million Cups Denver");
  });

  it(`cuts a long title to ${EVENT_TITLE_WORDS} words and marks the cut`, () => {
    const long = "Beck Venture Center Startup Forum: Biology and the New Frontier of Mining";
    const cut = clampWords(long);
    expect(cut).toBe("Beck Venture Center Startup Forum: Biology and the New…");
    expect(cut.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu)).toHaveLength(EVENT_TITLE_WORDS);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(clampWords("Founders & Friends: Welcome", 2)).toBe("Founders & Friends…");
  });
});
