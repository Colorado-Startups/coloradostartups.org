import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DwarfSchema, VISITOR_KINDS, WAYS_IN, WelcomeRouteSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { deskSteps, FOUNDER_KINDS } from "../../../src/lib/communitas/route";
import { SYSTEM_PROMPT } from "../../../worker/resourcus/prompt";

// L10's founder-first contract (decisions 43, 46 and 49). The L5 tests hold
// the desk's hard rules. These hold the direction: founders first, the wider
// startup community second, and keepers that never moderate. They check
// structure and rules, not wording, so copy edits stay cheap.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const routes = (parse(read("data/communitas/routes.yaml")) as unknown[]).map((r) => WelcomeRouteSchema.parse(r));
const slack = parse(read("data/communitas/slack.yaml")) as { welcome: { lines: string[] }; help: { lines: string[] } };
const threads = parse(read("data/communitas/threads.yaml")) as { id: string; body: string }[];
const keepers = (parse(read("data/team/dwarves.yaml")) as unknown[]).map((d) => DwarfSchema.parse(d));

const sentences = (text: string) => text.split(/(?<=[.?!;])\s+/);

describe("the welcome desk doors", () => {
  it("run founders first, then the startup community, then everyone else", () => {
    expect([...VISITOR_KINDS]).toEqual([
      "idea",
      "building",
      "hiring",
      "talent",
      "investing",
      "service-provider",
      "student",
      "curious",
    ]);
    expect([...FOUNDER_KINDS]).toEqual(VISITOR_KINDS.slice(0, 3));
  });

  it("are listed in routes.yaml in door order", () => {
    expect(routes.map((r) => r.id)).toEqual([...VISITOR_KINDS]);
  });

  it("name the talent and investing doors in the lane contract's words", () => {
    const label = (id: string) => routes.find((r) => r.id === id)?.label;
    expect(label("talent")).toBe("I want to work at a startup");
    expect(label("investing")).toBe("I invest in or lend to startups");
  });

  it("offer the founders forum on every founder door, beside a step a founder can take today", () => {
    for (const visitor of FOUNDER_KINDS) {
      const hrefs = deskSteps(visitor, routes).map((s) => s.href);
      expect(hrefs, visitor).toContain(WAYS_IN.discourse);
      expect(hrefs.filter((h) => h !== WAYS_IN.discourse).length, visitor).toBeGreaterThanOrEqual(1);
    }
  });

  it("keep the founders forum off every other door", () => {
    for (const visitor of VISITOR_KINDS.filter((k) => !FOUNDER_KINDS.includes(k))) {
      expect(deskSteps(visitor, routes).map((s) => s.href), visitor).not.toContain(WAYS_IN.discourse);
    }
  });
});

describe("Communitas in Slack", () => {
  it("speaks to founders before anyone else in the welcome DM", () => {
    const text = slack.welcome.lines.join(" ");
    const founders = text.search(/founder/i);
    expect(founders).toBeGreaterThanOrEqual(0);
    for (const other of [/service provider/i, /talent/i, /investor/i]) {
      const at = text.search(other);
      if (at >= 0) expect(founders, String(other)).toBeLessThan(at);
    }
  });

  it("addresses founders in every weekly opener", () => {
    for (const t of threads) expect(t.body, t.id).toMatch(/\bfounders?\b/i);
  });
});

// A sentence that mentions moderating must deny it for the keeper or hand it
// to people. Matching is narrow on purpose: only sentences about moderating.
function claimsModeration(sentence: string): boolean {
  return /moderat/i.test(sentence) && !/\bnever\b|\bpeople\b/i.test(sentence);
}

describe("the keepers never moderate (decision 43)", () => {
  const copy = [
    ...slack.welcome.lines,
    ...slack.help.lines,
    ...threads.map((t) => t.body),
    ...keepers.flatMap((k) => [k.role, k.bio, ...k.voice, ...k.can_help_with, k.disclosure]),
  ].flatMap(sentences);

  it("self-test: flags a moderation claim and passes a denial", () => {
    expect(claimsModeration("Communitas moderates the Slack.")).toBe(true);
    expect(claimsModeration("It never moderates; people do.")).toBe(false);
    expect(claimsModeration("People moderate this Slack.")).toBe(false);
  });

  it("say so in the Slack help and in Communitas's bio", () => {
    expect(slack.help.lines.join(" ")).toMatch(/I never moderate/);
    expect(keepers.find((k) => k.id === "communitas")?.bio).toMatch(/never moderates/);
  });

  it("never claim to moderate anywhere in their copy", () => {
    for (const s of copy) expect(claimsModeration(s), s).toBe(false);
  });
});

describe("founder-first lines outside the desk", () => {
  it("Resourcus's scope sentence names founders first", () => {
    expect(SYSTEM_PROMPT).toContain("You help founders and the people who back them find Colorado startup resources");
  });

  it("the privacy notice opens with the founder-first positioning", () => {
    expect(read("data/legal/privacy.md")).toContain(
      "runs this website for a community of entrepreneurs building companies in Colorado",
    );
  });
});
