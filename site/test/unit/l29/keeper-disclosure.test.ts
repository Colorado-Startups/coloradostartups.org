// L29: llms.txt discloses each keeper as an AI agent in every sentence that
// names it. This runs on the source file, so pre-push catches a slip before a
// build. test/dom/l13/info-pages.test.ts runs the same check on dist/llms.txt.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { keeperNames, sentences, undisclosedKeeperSentences } from "./keeper-disclosure";

const LLMS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/llms.txt");
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

describe("site/public/llms.txt", () => {
  it("reads the keepers from data/team/dwarves.yaml", () => {
    expect(keeperNames().length).toBeGreaterThan(0);
  });

  it("says AI agent in every sentence that names a keeper", () => {
    const llms = readFileSync(LLMS, "utf8");
    const named = keeperNames().filter((k) => llms.includes(k));
    expect(named.length, "llms.txt names at least one keeper").toBeGreaterThan(0);
    expect(undisclosedKeeperSentences(llms, keeperNames())).toEqual([]);
  });
});
