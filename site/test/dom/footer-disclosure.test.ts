import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { contentPages, SITE_DIR } from "./pages";

// The footer's AI note is the one disclosure on every page (BRIEF section 2,
// constraint 10; .claude/rules/ai-disclosure.md). SiteFooter.astro
// builds its list of names from data/team/dwarves.yaml. This test checks every
// built page against that file, so a dropped note, a missing keeper or a lost
// "AI agents" line fails the build. Run `npm run build` first.

const keepers = parse(readFileSync(path.join(SITE_DIR, "..", "data/team/dwarves.yaml"), "utf8")) as { name: string }[];
const NAMES = keepers.map((k) => k.name);
const REQUIRED = ["are AI agents run by Colorado Startups", "The Hall art is AI-generated"];

/** What is wrong with a page's footer disclosure; empty when it is whole. */
export function footerDisclosureProblems(html: string, names: readonly string[]): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const notes = doc.querySelectorAll(".site-footer .ai-note");
  if (notes.length !== 1) return [`expected one footer AI note, found ${notes.length}`];
  const text = (notes[0].textContent ?? "").replace(/\s+/g, " ").trim();
  const problems = names.filter((name) => !text.includes(name)).map((name) => `does not name ${name}`);
  problems.push(...REQUIRED.filter((line) => !text.includes(line)).map((line) => `missing "${line}"`));
  return problems;
}

describe("footerDisclosureProblems", () => {
  const footer = (note: string) => `<footer class="site-footer"><p class="ai-note">${note}</p></footer>`;

  it("passes a whole note (known clean)", () => {
    const note = "Ann and Bo are AI agents run by Colorado Startups. The Hall art is AI-generated.";
    expect(footerDisclosureProblems(footer(note), ["Ann", "Bo"])).toEqual([]);
  });

  it("flags a missing note, a missing keeper and a missing line (known bad)", () => {
    expect(footerDisclosureProblems("<footer class='site-footer'></footer>", ["Ann"])).toEqual([
      "expected one footer AI note, found 0",
    ]);
    expect(footerDisclosureProblems(footer("Ann is a helper. The Hall art is AI-generated."), ["Ann", "Bo"])).toEqual([
      "does not name Bo",
      'missing "are AI agents run by Colorado Startups"',
    ]);
  });

  it("flags the old label, which covered only the characters (known bad)", () => {
    const note = "Ann and Bo are AI agents run by Colorado Startups. Character art is AI-assisted.";
    expect(footerDisclosureProblems(footer(note), ["Ann", "Bo"])).toEqual([
      'missing "The Hall art is AI-generated"',
    ]);
  });
});

describe("the footer AI note on every built page", () => {
  it("lists the keepers from dwarves.yaml", () => {
    expect(NAMES.length).toBeGreaterThan(0);
  });

  for (const page of contentPages()) {
    it(`${page.route} discloses every keeper as an AI agent`, () => {
      expect(footerDisclosureProblems(page.html, NAMES)).toEqual([]);
    });
  }
});
