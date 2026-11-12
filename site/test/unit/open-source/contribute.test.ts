// Open-source plan (#552): the /contribute/ page's words and its off switch.
// The page builds nothing until phase 6 flips CONTRIBUTE_LIVE, so these tests
// read the data and the route file instead of a built page.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CONTRIBUTE_INTRO,
  CONTRIBUTE_LIVE,
  contributePaths,
  CONTRIBUTING_URL,
  DISCUSSIONS_URL,
  FLOW,
  GOOD_FIRST_ISSUES_URL,
  REPO_URL,
  REVIEW_ROWS,
} from "../../../src/components/info/contribute";

const ROUTE = readFileSync(new URL("../../../src/pages/contribute/[...path].astro", import.meta.url), "utf8");
const copy = [CONTRIBUTE_INTRO, ...FLOW.flatMap((s) => [s.title, s.body]), ...REVIEW_ROWS.flatMap((r) => [r.change, r.merges]), ROUTE].join(" ");

describe("/contribute/ off switch", () => {
  it("stays off until the public repo exists (phase 6 flips it)", () => {
    expect(CONTRIBUTE_LIVE).toBe(false);
  });

  it("builds no page while off, and the one /contribute/ page when on", () => {
    expect(contributePaths(false)).toEqual([]);
    expect(contributePaths(true)).toEqual([{ params: { path: undefined } }]);
  });
});

describe("/contribute/ copy", () => {
  it("uses no volunteer, paid or hiring wording (decision 44)", () => {
    expect(copy).not.toMatch(/\b(volunteer\w*|paid|pay|salary|stipend|hiring|hire|job|jobs)\b/i);
  });

  it("calls every AI reviewer an AI agent", () => {
    expect(copy).toMatch(/AI agents? review/);
    expect(copy).not.toMatch(/\bbots?\b/i);
  });

  it("says a merge reaches staging before the live site", () => {
    expect(FLOW.at(-1)?.body).toMatch(/staging first/);
  });

  it("links only to the public repo", () => {
    for (const url of [DISCUSSIONS_URL, GOOD_FIRST_ISSUES_URL, CONTRIBUTING_URL]) expect(url.startsWith(`${REPO_URL}/`)).toBe(true);
    expect(REPO_URL).toBe("https://github.com/Colorado-Startups/coloradostartups.org");
  });

  it("has no em dash or spaced en dash", () => {
    expect(copy).not.toMatch(/—| – /);
  });
});
