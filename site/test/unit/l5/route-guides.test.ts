import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WAYS_IN, type WayInKind, type WelcomeRoute, WelcomeRouteSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { deskSteps, WAY_LABELS } from "../../../src/lib/communitas/route";
import { GUIDE_SLUGS, GUIDES, guidePath, type GuideSlug } from "../../../src/lib/guides/guides";

// Card #150: the idea and building doors open the matching founder guide. The
// guide kinds in WAYS_IN hold literal paths, because packages/shared cannot
// import the site's guide list; this file fails if a slug moves.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const routes: WelcomeRoute[] = (
  parse(readFileSync(path.join(ROOT, "data/communitas/routes.yaml"), "utf8")) as unknown[]
).map((r) => WelcomeRouteSchema.parse(r));

const GUIDE_KINDS: [WayInKind, GuideSlug][] = [
  ["guide-start", "start-a-company-in-colorado"],
  ["guide-accelerators", "colorado-accelerators-and-incubators"],
];

describe.each(GUIDE_KINDS)("the %s way in", (kind, slug) => {
  it(`opens /guides/${slug}/, a guide the site builds`, () => {
    expect(GUIDE_SLUGS).toContain(slug);
    expect(WAYS_IN[kind]).toBe(guidePath(slug));
  });

  it("says which guide it opens", () => {
    expect(WAY_LABELS[kind].toLowerCase()).toContain(GUIDES[slug].title.toLowerCase());
  });
});

describe("the founder doors that open a guide", () => {
  const hrefs = (visitor: WelcomeRoute["id"]) => deskSteps(visitor, routes).map((s) => s.href);

  it('"I have an idea" opens How to start a company in Colorado', () => {
    expect(hrefs("idea")).toContain(WAYS_IN["guide-start"]);
  });

  it('"I\'m building a company" opens the accelerators and incubators guide', () => {
    expect(hrefs("building")).toContain(WAYS_IN["guide-accelerators"]);
  });

  it("keep the Slack and the founders forum beside the guide", () => {
    for (const visitor of ["idea", "building"] as const) {
      expect(hrefs(visitor), visitor).toEqual(expect.arrayContaining([WAYS_IN.slack, WAYS_IN.discourse]));
    }
  });
});
