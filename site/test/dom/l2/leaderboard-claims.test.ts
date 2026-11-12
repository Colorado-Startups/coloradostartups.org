// L2 over the built site (run `npm run build` first; test:content does): what
// the site says about the Leaderboard matches the latest edition (GO-LIVE C4).
// Search engines and AI assistants quote the meta description and the page
// copy, so a ranking claim the data does not back would spread from here.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type Edition, EditionSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { latestEdition } from "../../../src/lib/leaderboard/board";
import { builtPages, readDist, SITE_DIR } from "../pages";

const EDITIONS = path.resolve(SITE_DIR, "..", "data", "leaderboard", "editions");
// YAML 1.1, as Astro's content loader reads it (see test/unit/l2/data.test.ts).
const editions: Edition[] = readdirSync(EDITIONS)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => EditionSchema.parse(parse(readFileSync(path.join(EDITIONS, f), "utf8"), { version: "1.1" })));
const edition = latestEdition(editions)!;

const page = new DOMParser().parseFromString(readDist("leaderboard/index.html"), "text/html");
const meta = (selector: string) => page.querySelector(selector)?.getAttribute("content") ?? "";
const description = meta('meta[name="description"]');

describe("/leaderboard/ meta description", () => {
  it("names the latest edition", () => {
    expect(description).toContain(edition.title);
  });

  // A tripwire both ways: when the first verified (ranked) edition becomes the
  // latest, this fails until the description stops saying "unranked".
  it("says unranked exactly while the latest edition is unranked", () => {
    if (edition.kind === "honorees") expect(description).toMatch(/\bunranked\b/);
    else expect(description).not.toMatch(/\bunranked\b/);
  });

  it("makes no growth or ranking claim the edition does not back", () => {
    expect(description).not.toMatch(/fastest|top\s+(?:companies|startups)|best\b/i);
  });

  it("is the same text in the Open Graph description", () => {
    expect(meta('meta[property="og:description"]')).toBe(description);
  });
});

// The lede, the home teaser and the /links/ label once said "fastest-growing",
// and llms.txt said verified editions "rank companies" as present fact. Nothing
// ranks companies by growth until a verified edition is the latest, so no
// built page and no llms.txt may claim it before then: copy, meta tags and
// JSON-LD alike. Raw files are searched, not a parsed DOM, so the check stays
// fast.
const GROWTH_CLAIM = /fastest[-\s]+growing/i;
// An edition or the Leaderboard that ranks companies now. "will rank" does not
// match, and neither does the nomination promise to use data "only to verify
// and rank companies" (hard constraint 8), which states a use, not a ranking.
const PRESENT_RANKING = /\b(?:editions?|leaderboard)\s+ranks?\s+companies\b/i;

describe("growth and ranking claims across the built site", () => {
  it("self-test: catches each claim and passes the future tense", () => {
    expect(GROWTH_CLAIM.test("the fastest-growing companies in Colorado")).toBe(true);
    expect(PRESENT_RANKING.test("how verified editions rank companies by revenue growth")).toBe(true);
    expect(PRESENT_RANKING.test("The Leaderboard ranks companies by growth.")).toBe(true);
    expect(PRESENT_RANKING.test("The first verified edition will rank companies by revenue growth.")).toBe(false);
    expect(PRESENT_RANKING.test("We use nomination data only to verify and rank companies for the Leaderboard.")).toBe(
      false,
    );
  });

  it("makes no growth or ranking claim in any page or llms.txt while the latest edition is unranked", () => {
    if (edition.kind !== "honorees") return;
    const files = [
      ...builtPages().map((p) => ({ route: p.route, text: p.html })),
      { route: "/llms.txt", text: readDist("llms.txt") },
    ];
    expect(files.length).toBeGreaterThan(1);
    expect(files.filter((f) => GROWTH_CLAIM.test(f.text)).map((f) => f.route)).toEqual([]);
    expect(files.filter((f) => PRESENT_RANKING.test(f.text)).map((f) => f.route)).toEqual([]);
  });
});
