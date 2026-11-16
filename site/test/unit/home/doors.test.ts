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
import { clampWords, doorPlan, EVENT_TITLE_WORDS, picksHref } from "../../../src/lib/communitas/doors";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const routes = (parse(read("data/communitas/routes.yaml")) as unknown[]).map((r) => WelcomeRouteSchema.parse(r));
const threads = (parse(read("data/communitas/threads.yaml")) as unknown[]).map((t) => ThreadOpenerSchema.parse(t));

const card = (id: string): ResourceCard => ({ id, name: id }) as ResourceCard;
const allPicks: StagePicks[] = (["idea", "launch", "growth", "support"] as const).map((stage) => ({
  stage,
  picks: [{ card: card(`${stage}-1`), reason: "first-need" as const }],
}));
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
        return [r.id, `${p.label} | ${p.slack.dayName} ${p.slack.title} | ${p.resources.text}`];
      }),
    );
    expect(table).toEqual({
      idea: "Idea | Monday Monday Welcome | Idea picks",
      building: "Building | Wednesday Asks and Offers | Launch picks",
      hiring: "Hiring | Wednesday Asks and Offers | Growth picks",
      talent: "Job seeker | Wednesday Asks and Offers | Startup Resources",
      investing: "Investor or lender | Monday Monday Welcome | Startup Resources",
      "service-provider": "Services | Wednesday Asks and Offers | Startup Resources",
      student: "Student | Monday Monday Welcome | Idea picks",
      curious: "Curious | Monday Monday Welcome | Startup Resources",
    });
  });

  it("links a stage's picks on Startup Resources, through WAYS_IN", () => {
    const plan = doorPlan(route({ picks_stage: "launch" }), threads, allPicks);
    expect(plan.resources).toEqual({ stage: "launch", href: `${WAYS_IN.canvas}#start-launch`, text: "Launch picks" });
    expect(picksHref("idea").startsWith(`${WAYS_IN.canvas}#`)).toBe(true);
  });

  it("falls back to Startup Resources when the stage has no picks or the door names none", () => {
    const empty = allPicks.map((s) => (s.stage === "growth" ? { ...s, picks: [] } : s));
    for (const r of [route({ picks_stage: "growth" }), route({})]) {
      expect(doorPlan(r, threads, empty).resources).toEqual({ stage: null, href: WAYS_IN.canvas, text: "Startup Resources" });
    }
  });

  it("never gives the investor or service-provider door a stage, since picks are for founders", () => {
    for (const id of ["investing", "service-provider"] as const) {
      expect(doorPlan(routes.find((r) => r.id === id)!, threads, allPicks).resources.stage, id).toBeNull();
    }
  });

  it("starts in the Monday Welcome when the door names no thread, or one threads.yaml lacks", () => {
    expect(doorPlan(route({}), threads, allPicks).slack.day).toBe("mon");
    const noFriday = threads.filter((t) => t.day !== "fri");
    expect(doorPlan(route({ slack_thread: "fri" }), noFriday, allPicks).slack.day).toBe("mon");
    expect(doorPlan(route({ slack_thread: "wed" }), threads, allPicks).slack).toMatchObject({ day: "wed", dayName: "Wednesday" });
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
