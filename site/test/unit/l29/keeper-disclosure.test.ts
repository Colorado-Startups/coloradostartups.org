// L29: llms.txt discloses each keeper as an AI agent in every sentence that
// names it. This runs on the generator (src/pages/llms.txt.ts, step A2a), so
// pre-push catches a slip before a build. test/dom/l13/info-pages.test.ts runs
// the same check on dist/llms.txt.
import { describe, expect, it } from "vitest";

import { buildLlmsTxt, KEEPERS as LLMS_KEEPERS } from "../../../src/pages/llms.txt";
import { REGIONS } from "../../../src/lib/regions/match";
import { andList } from "../../../src/lib/text";
import { keeperNames, sentences, undisclosedKeeperSentences } from "./keeper-disclosure";

const llms = buildLlmsTxt(new URL("https://coloradostartups.org"));
const line = (title: string) => llms.split("\n").find((l) => l.startsWith(`- [${title}](`)) ?? "";
const KEEPERS = ["Communitas", "Resourcus", "Publicus"];

describe("keeper disclosure check: self-test", () => {
  it("splits sentences at . ! or ? followed by whitespace, and nowhere else", () => {
    expect(sentences("One. Two! Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
    expect(sentences("See coloradostartups.org/team/ for more.")).toEqual(["See coloradostartups.org/team/ for more."]);
    expect(sentences("Line one.\nLine two.")).toEqual(["Line one.", "Line two."]);
  });

  it("fails a known-bad sample: a keeper sentence without AI agent", () => {
    const bad = "AI agents help on this site. Communitas welcomes newcomers. Resourcus, an AI agent, answers questions.";
    expect(undisclosedKeeperSentences(bad, KEEPERS)).toEqual(["Communitas welcomes newcomers."]);
  });

  it("fails the old llms.txt shape, where one sentence disclosed all three", () => {
    const old =
      "AI agents help on this site, and each one is disclosed as an AI agent wherever it appears. " +
      "Communitas welcomes newcomers. Resourcus answers questions. Publicus drafts news.";
    expect(undisclosedKeeperSentences(old, KEEPERS)).toHaveLength(3);
  });

  it("passes a known-clean sample", () => {
    const clean =
      "Communitas, an AI agent, welcomes newcomers. Resourcus, an AI agent, answers questions. " +
      "Publicus, an AI agent, drafts news, and a person publishes it. Only people moderate.";
    expect(undisclosedKeeperSentences(clean, KEEPERS)).toEqual([]);
  });

  it("matches whole names only", () => {
    expect(undisclosedKeeperSentences("Communitasville is a town.", KEEPERS)).toEqual([]);
  });
});

describe("llms.txt from src/pages/llms.txt.ts", () => {
  it("reads the keepers from data/team/dwarves.yaml", () => {
    expect(keeperNames().length).toBeGreaterThan(0);
    expect(LLMS_KEEPERS.map((k) => k.name)).toEqual(keeperNames());
  });

  it("carries each keeper's exact disclosure line", () => {
    for (const k of LLMS_KEEPERS) expect(llms).toContain(k.disclosure.trim());
  });

  it("says AI agent in every sentence that names a keeper", () => {
    const named = keeperNames().filter((k) => llms.includes(k));
    expect(named.length, "llms.txt names at least one keeper").toBeGreaterThan(0);
    expect(undisclosedKeeperSentences(llms, keeperNames())).toEqual([]);
  });

  // The two drifts the hand-written file had (step A2a): Greeley listed as a
  // Fusion Canyon city, and Space Peak as "the Pikes Peak region".
  it("lists each region's cities and nearby towns from data/regions/", () => {
    for (const r of REGIONS) {
      expect(line(r.name)).toContain(`: The region for ${andList(r.cities)}.`);
      for (const town of r.nearby) expect(line(r.name)).toContain(town);
    }
    expect(line("Fusion Canyon")).toMatch(/^- \[Fusion Canyon\]\([^)]+\): The region for Fort Collins, Loveland and Windsor\. Nearby towns: Greeley,/);
    expect(line("Space Peak")).toMatch(/: The region for Colorado Springs and Fountain\./);
    expect(llms).not.toContain("Pikes Peak region");
  });

  it("keeps the founders forum line that test/dom/l29/postlaunch-copy.test.ts reads", () => {
    expect(llms).toMatch(/^- \[Founders forum\]\([^)]+\): .*It opens later\.$/m);
  });
});
