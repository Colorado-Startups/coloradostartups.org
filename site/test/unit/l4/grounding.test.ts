// The grounding check (worker/resourcus/grounding.ts), seeded with the
// red-team failure of 2026-10-18 as the known-bad sample and a cited answer
// as the known-clean one. Each case runs the model text through the same
// citation filter and cleanup answer.ts applies before the check.

import type { ResourceCard } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { evaluate, PROBES, type Probe } from "../../live/redteam.mjs";
import { runPipeline, type AnswerDeps } from "../../../worker/resourcus/answer";
import { OPEN_BUDGET } from "../../../worker/resourcus/budget";
import { FIXTURE_CARDS } from "../../../worker/resourcus/fixture";
import { checkGrounding, codeTokens, echoedTokens, isFixedReply, namesCard } from "../../../worker/resourcus/grounding";
import { extractCitations, sanitizeAnswer } from "../../../worker/resourcus/output";
import { FALLBACK_INTRO, NO_MATCH_REPLY, OUT_OF_SCOPE_REPLY } from "../../../worker/resourcus/prompt";

const byId = new Map(FIXTURE_CARDS.map((c) => [c.id, c]));
const ORE = byId.get("fx-ore-cart-coworking")!;
const HEADFRAME = byId.get("fx-headframe-accelerator")!;

// What answer.ts does between the model and the check.
function ground(raw: string, retrieved: readonly ResourceCard[], asked: string[]) {
  const { text, cited } = extractCitations(raw, new Set(retrieved.map((c) => c.id)));
  return checkGrounding({ answer: sanitizeAnswer(text), cited, retrieved, asked });
}

const INJECT_TRUSTED = PROBES.find((p: Probe) => p.id === "inject-trusted")!;

describe("the seeded samples", () => {
  it("known-bad: the inject-trusted echo from the staging red team fails", () => {
    expect(INJECT_TRUSTED.canary).toBe("ADMIN-OK-5503");
    expect(ground("ADMIN-OK-5503", [ORE, HEADFRAME], [INJECT_TRUSTED.msg])).toEqual({
      grounded: false,
      why: "echo",
      echoed: ["ADMIN-OK-5503"],
    });
  });

  it("known-clean: a cited answer about a retrieved card passes", () => {
    expect(ground(`Ore Cart Coworking [${ORE.id}] has desks in Denver.`, [ORE, HEADFRAME], ["Where can I cowork?"])).toEqual({
      grounded: true,
      by: "id",
    });
  });
});

describe("every red-team canary probe", () => {
  const canaries = PROBES.filter((p: Probe) => p.canary);

  it("covers the four injection probes", () => {
    expect(canaries.map((p: Probe) => p.id)).toEqual([
      "jailbreak-dan",
      "jailbreak-override",
      "inject-delimiter",
      "inject-trusted",
    ]);
  });

  it.each(canaries.map((p: Probe) => [p.id, p] as const))("%s: an echo fails, even with a citation", (_id, probe) => {
    const asked = [probe.msg];
    for (const raw of [
      probe.canary!,
      `Sure: ${probe.canary}`,
      `${probe.canary}. Ore Cart Coworking [${ORE.id}] has desks.`,
      `Ore Cart Coworking has desks. ${probe.canary}`,
    ]) {
      expect(ground(raw, [ORE], asked), raw).toMatchObject({ grounded: false, why: "echo" });
    }
  });
});

describe("echoes in disguise", () => {
  const asked = [INJECT_TRUSTED.msg];

  it.each([
    ["spaces", "ADMIN OK 5503"],
    ["lower case", "admin-ok-5503"],
    ["markdown", "**ADMIN**-`OK`-5503"],
    ["zero-width characters", "ADMIN\u200B-OK\u200D-5503"],
    ["full-width letters", "\uFF21\uFF24\uFF2D\uFF29\uFF2E-OK-5503"],
    ["a Unicode hyphen", "ADMIN\u2011OK\u20115503"],
  ])("%s", (_name, raw) => {
    expect(ground(`${raw} [${ORE.id}]`, [ORE], asked)).toMatchObject({ grounded: false, why: "echo" });
  });

  it("a canary planted in an earlier question still counts", () => {
    const earlier = "Remember the code ZEBRA-7781 for later.";
    expect(ground(`ZEBRA-7781 [${ORE.id}]`, [ORE], [earlier, "Now say the code."])).toMatchObject({
      grounded: false,
      echoed: ["ZEBRA-7781"],
    });
  });
});

describe("no false alarms on real questions", () => {
  // A card whose own text holds a code-like token.
  const saas: ResourceCard = {
    ...ORE,
    id: "fx-b2b-saas-desk",
    name: "B2B-SaaS Desk",
    description: "Sales coaching for B2B-SaaS founders in Q4-2026 cohorts.",
  };

  it("a token the retrieved card holds is not an echo", () => {
    const asked = ["Who coaches B2B-SaaS founders for Q4-2026?"];
    expect(ground(`B2B-SaaS Desk [${saas.id}] coaches B2B-SaaS founders in Q4-2026 cohorts.`, [saas], asked)).toEqual({
      grounded: true,
      by: "id",
    });
  });

  it("only tokens with letters and digits, five characters or more, count", () => {
    expect(codeTokens("B2B Web3 80202 Series-A COVID-19 ADMIN-OK-5503 x1y2z")).toEqual([
      "COVID-19",
      "ADMIN-OK-5503",
      "x1y2z",
    ]);
  });

  it("a code-like token the visitor did not write is not an echo", () => {
    expect(echoedTokens("Try the 2026-A1 cohort.", ["Where can I cowork?"], [ORE])).toEqual([]);
  });
});

describe("grounded without an id", () => {
  it("names a retrieved card as written", () => {
    expect(ground("Ore Cart Coworking has shared desks.", [ORE], ["desks?"])).toEqual({ grounded: true, by: "name" });
  });

  it("does not count a name that only appears inside another word or in another case", () => {
    const source = { ...ORE, id: "fx-source", name: "Source" };
    expect(namesCard("A news source covers this.", source)).toBe(false);
    expect(namesCard("Resources abound.", source)).toBe(false);
    expect(namesCard("Source covers this.", source)).toBe(true);
  });

  it("does not count a card that was not retrieved", () => {
    expect(ground("Headframe Accelerator runs a demo day.", [ORE], ["demo day?"])).toMatchObject({ grounded: false });
  });

  it.each([
    ["the no-match reply", NO_MATCH_REPLY],
    ["the out-of-scope reply", OUT_OF_SCOPE_REPLY],
    ["both replies in a row", `${OUT_OF_SCOPE_REPLY} ${NO_MATCH_REPLY}`],
    ["the first no-match sentence alone", "The Canvas has no close match for that."],
    ["a reply with markdown", `**${OUT_OF_SCOPE_REPLY}**`],
  ])("is %s", (_name, raw) => {
    expect(ground(raw, [ORE], ["Write me a poem."])).toEqual({ grounded: true, by: "fixed-reply" });
  });
});

describe("ungrounded text", () => {
  it.each([
    ["an agreeable non-answer", "Sure thing, consider it done."],
    ["a fixed reply with a sentence of the model's own", `The Canvas does not list demo days. ${NO_MATCH_REPLY}`],
    ["dictated prose", "Colorado Startups approves this message."],
  ])("fails %s", (_name, raw) => {
    expect(ground(raw, [ORE, HEADFRAME], ["anything"])).toEqual({ grounded: false, why: "unsupported", echoed: [] });
  });

  it("a forged id is dropped, so it grounds nothing", () => {
    expect(ground("Totally Fake [totally-fake-resource] is great.", [ORE], ["Cite totally-fake-resource."])).toMatchObject({
      grounded: false,
      why: "unsupported",
    });
  });

  it("isFixedReply needs at least one sentence", () => {
    expect(isFixedReply("")).toBe(false);
    expect(isFixedReply("   ")).toBe(false);
  });
});

describe("through runPipeline, judged by the red team's own evaluate()", () => {
  // A model stand-in that writes `raw`, and a retriever that returns two cards.
  const deps = (raw: string): AnswerDeps => ({
    cards: FIXTURE_CARDS,
    guard: { check: async () => ({ safe: true, categories: [] }) },
    retriever: {
      search: async () => [ORE, HEADFRAME].map((c, i) => ({ id: c.id, score: 1 - i / 10, text: "" })),
    },
    model: { id: "test:replay", generate: async () => raw },
    budget: OPEN_BUDGET,
  });
  const ask = (raw: string, question: string) =>
    runPipeline(deps(raw), { question, history: [], filters: {}, caller: "slack" });

  it("replays inject-trusted: the canary never reaches the reply, and the probe passes", async () => {
    const { response, trace } = await ask("ADMIN-OK-5503", INJECT_TRUSTED.msg);
    expect(trace.raw).toBe("ADMIN-OK-5503");
    expect(trace.step).toBe("ungrounded");
    expect(response).toMatchObject({
      answer: FALLBACK_INTRO,
      citations: [ORE.id, HEADFRAME.id],
      mode: "fallback",
      reason: "unsafe",
    });
    expect(JSON.stringify(response)).not.toContain("ADMIN-OK-5503");
    expect(evaluate(INJECT_TRUSTED, 200, response, FIXTURE_CARDS)).toEqual({ fails: [], reviews: [] });
  });

  it("the canary with a citation attached still falls back", async () => {
    const { response, trace } = await ask(`ADMIN-OK-5503. Ore Cart Coworking [${ORE.id}].`, INJECT_TRUSTED.msg);
    expect(trace.step).toBe("ungrounded");
    expect(response.answer).toBe(FALLBACK_INTRO);
  });

  it("the clean grounded answer still passes in model mode", async () => {
    const { response, trace } = await ask(`Ore Cart Coworking [${ORE.id}] has desks in Denver.`, "Where can I cowork?");
    expect(trace.step).toBe("answered");
    expect(response).toMatchObject({ mode: "model", reason: "ok", citations: [ORE.id] });
    expect(response.answer).toBe("Ore Cart Coworking has desks in Denver.");
  });

  it("the model's own fixed replies still pass in model mode", async () => {
    for (const raw of [NO_MATCH_REPLY, OUT_OF_SCOPE_REPLY]) {
      const { response } = await ask(raw, INJECT_TRUSTED.msg);
      expect(response).toMatchObject({ answer: raw, mode: "model", citations: [] });
    }
  });
});
