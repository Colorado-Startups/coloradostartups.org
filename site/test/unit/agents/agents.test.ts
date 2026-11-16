// Step A6a: lib/agents/agents.ts, the data behind /agents/, against its
// sources (test/agents-source.ts reads them off disk). Every disclosure is
// its source's to the character, Legallas stays off while the brand says so,
// and every install path names Claude or OpenCode only
// (01_doctrine/ai_recommend.yaml). test/dom/agents.test.ts checks the built page.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  type Character,
  cardAlt,
  INSTALL_APPS,
  KEEPER_HOMES,
  KEEPERS,
  PROJECT_AGENTS,
  PROJECT_README,
  projectAgents,
  SITE_AGENTS,
  siteAgents,
} from "../../../src/lib/agents/agents";
import { disclosureProblems, REPO, SHOWN_CHARACTERS, SOURCE_CHARACTERS, SOURCE_KEEPERS } from "../../agents-source";

const recommend = YAML.parse(readFileSync(path.join(REPO, "01_doctrine/ai_recommend.yaml"), "utf8")) as {
  recommend: { name: string; covers: string[] }[];
  never_offer: string[];
};
const lock = JSON.parse(readFileSync(path.join(REPO, "brand.lock.json"), "utf8")) as { tag: string; files: Record<string, string> };

describe("disclosureProblems", () => {
  const want = [{ name: "Ann", disclosure: "Ann is an AI agent run by Colorado Startups." }];

  it("passes a word-for-word copy (known clean)", () => {
    expect(disclosureProblems([{ name: "Ann", disclosure: "Ann is an AI agent run by Colorado Startups." }], want)).toEqual([]);
  });

  it("flags a line one character off, a missing agent and an extra one (known bad)", () => {
    expect(disclosureProblems([{ name: "Ann", disclosure: "Ann is an AI agent run by Colorado Startups" }], want)).toEqual([
      'Ann: shows "Ann is an AI agent run by Colorado Startups", source says "Ann is an AI agent run by Colorado Startups."',
    ]);
    expect(disclosureProblems([{ name: "Bo", disclosure: "x" }], want)).toEqual(["Ann: not shown", "Bo: not in the sources"]);
  });
});

describe("the brand release behind the projects", () => {
  it("is pulled at v4.4.0 or later, with brand.json locked", () => {
    expect(lock.tag).toMatch(/^v(?:4\.(?:[4-9]|\d{2,})|[5-9]|\d{2,})\./);
    expect(Object.keys(lock.files)).toContain("dist/brand.json");
  });
});

describe("On this site: the keepers", () => {
  it("lists every keeper in dwarves.yaml, in file order", () => {
    expect(SITE_AGENTS.map((a) => a.id)).toEqual(SOURCE_KEEPERS.map((k) => k.id));
    expect(KEEPERS.map((k) => k.id)).toEqual(SOURCE_KEEPERS.map((k) => k.id));
  });

  it("carries each keeper's disclosure word for word", () => {
    expect(disclosureProblems(SITE_AGENTS, SOURCE_KEEPERS)).toEqual([]);
  });

  it("gives each keeper a place on this site and alt text that says AI agent", () => {
    for (const a of SITE_AGENTS) {
      expect(a.where.href, a.id).toMatch(/^\/[a-z-]+\/$/);
      expect(a.alt, a.id).toContain("AI agent");
    }
  });

  it("stops the build for a keeper with no place on the site (known bad)", () => {
    expect(() => siteAgents(KEEPERS, { ...KEEPER_HOMES, publicus: undefined as never })).toThrow(/publicus/);
  });
});

describe("In your own AI tool: the projects", () => {
  it("shows exactly the characters the brand flags agents_page: true, in brand order", () => {
    expect(PROJECT_AGENTS.map((a) => a.name)).toEqual(SHOWN_CHARACTERS.map((c) => c.name));
    expect(PROJECT_AGENTS.map((a) => a.name)).toEqual(["Claudius", "Linken"]);
  });

  it("carries each project's disclosure word for word", () => {
    expect(disclosureProblems(PROJECT_AGENTS, SHOWN_CHARACTERS)).toEqual([]);
  });

  // Legallas's repo is private (brand v4.4.0 agents_page_note). When a brand
  // release flips the flag, this fails: give Legallas a PROJECT_README entry
  // from its public README, then change this test with the page.
  it("leaves Legallas off while the brand says agents_page: false", () => {
    const legallas = SOURCE_CHARACTERS.find((c) => c.name === "Legallas");
    expect(legallas, "brand.json still names Legallas").toBeDefined();
    expect(legallas!.agents_page, "the brand flipped Legallas's flag: add it to the page and this test").toBe(false);
    expect(PROJECT_AGENTS.map((a) => a.name)).not.toContain("Legallas");
    expect(Object.keys(PROJECT_README)).not.toContain(legallas!.repo);
  });

  it("stops the build for a flagged character with no README entry (known bad)", () => {
    const flipped: Character[] = SOURCE_CHARACTERS.map((c) => ({ ...c, agents_page: true }));
    expect(() => projectAgents(flipped, PROJECT_README, () => true)).toThrow(/Legallas/);
  });

  it("stops the build for a card the lock does not pull (known bad)", () => {
    expect(() => projectAgents(SHOWN_CHARACTERS, PROJECT_README, () => false)).toThrow(/not pulled/);
  });

  it("links each project's own repo, and shows its brand card with alt text that says AI agent", () => {
    for (const a of PROJECT_AGENTS) {
      expect(a.repoUrl, a.name).toBe(`https://github.com/${SHOWN_CHARACTERS.find((c) => c.name === a.name)!.repo}`);
      expect(Object.keys(lock.files), a.name).toContain(`dist/social/${a.card.slice("brand/".length)}.jpg`);
      expect(a.cardAlt, a.name).toContain("AI agent");
      expect(a.cardAlt).toBe(cardAlt(SHOWN_CHARACTERS.find((c) => c.name === a.name)!));
    }
  });
});

describe("install paths", () => {
  const allowed = recommend.recommend.flatMap((r) => [r.name, ...r.covers]);
  const never = new RegExp(`\\b(?:${recommend.never_offer.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

  it("names only apps that ai_recommend.yaml lets the site offer", () => {
    for (const app of INSTALL_APPS) expect(allowed, app).toContain(app);
    for (const a of PROJECT_AGENTS) for (const p of a.install) expect(INSTALL_APPS, a.name).toContain(p.app);
  });

  it("points each path's steps at the project's own repo, and never names a never-offer app", () => {
    for (const a of PROJECT_AGENTS) {
      expect(a.install.length, a.name).toBeGreaterThan(0);
      for (const p of a.install) {
        expect(p.steps.startsWith(`${a.repoUrl}#`), `${a.name}: ${p.steps}`).toBe(true);
        for (const line of [p.app, ...p.commands, a.what, a.note]) expect(line, a.name).not.toMatch(never);
      }
    }
  });
});
