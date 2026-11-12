import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VISITOR_KINDS, WAYS_IN, type WelcomeRoute, WelcomeRouteSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { deskSteps, MAX_STEPS, routeNewcomer, WAY_LABELS } from "../../../src/lib/communitas/route";

// The contract around routeNewcomer(). Any body Paul writes must keep these
// true; deskSteps() enforces the hard rules again whatever the body returns.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const routes: WelcomeRoute[] = (parse(readFileSync(path.join(ROOT, "data/communitas/routes.yaml"), "utf8")) as unknown[]).map(
  (r) => WelcomeRouteSchema.parse(r),
);

const isWayIn = (kind: keyof typeof WAYS_IN, href: string) =>
  href === WAYS_IN[kind] || (kind === "canvas" && href.startsWith(`${WAYS_IN.canvas}#`));

describe("routes.yaml", () => {
  it("has exactly one route for every visitor kind", () => {
    expect(routes.map((r) => r.id).sort()).toEqual([...VISITOR_KINDS].sort());
  });

  it("never recommends the Leaderboard to investors (decision 17)", () => {
    const investing = routes.find((r) => r.id === "investing")!;
    expect(investing.recommends.map((r) => r.kind)).not.toContain("leaderboard");
  });
});

describe.each([
  ["routeNewcomer", routeNewcomer],
  ["deskSteps", deskSteps],
] as const)("%s", (_name, route) => {
  it.each(VISITOR_KINDS.map((k) => [k]))("gives %s one to MAX_STEPS next steps", (kind) => {
    const steps = route(kind, routes);
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.length).toBeLessThanOrEqual(MAX_STEPS);
  });

  it("links every step through WAYS_IN, with the agreed label", () => {
    for (const visitor of VISITOR_KINDS) {
      for (const step of route(visitor, routes)) {
        expect(isWayIn(step.kind, step.href), `${visitor}: ${step.href}`).toBe(true);
        expect(step.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses the notes from routes.yaml", () => {
    for (const visitor of VISITOR_KINDS) {
      const notes = routes.find((r) => r.id === visitor)!.recommends.map((r) => r.note);
      for (const step of route(visitor, routes)) expect(notes).toContain(step.note);
    }
  });

  it("is deterministic", () => {
    for (const visitor of VISITOR_KINDS) expect(route(visitor, routes)).toEqual(route(visitor, routes));
  });
});

describe("deskSteps holds the hard rules whatever routeNewcomer returns", () => {
  const doctored: WelcomeRoute[] = routes.map((r) =>
    r.id === "investing"
      ? {
          ...r,
          recommends: [
            { kind: "leaderboard", note: "Doctored entry the guard must drop." },
            { kind: "discourse", note: "Founders only, so the guard must drop it." },
            ...r.recommends,
          ],
        }
      : r,
  );

  it("drops the Leaderboard for investors", () => {
    expect(deskSteps("investing", doctored).map((s) => s.kind)).not.toContain("leaderboard");
  });

  it("drops the founders forum for a visitor who is not a founder", () => {
    expect(deskSteps("investing", doctored).map((s) => s.kind)).not.toContain("discourse");
  });

  it("still shows the investor's real steps", () => {
    expect(deskSteps("investing", doctored).length).toBeGreaterThanOrEqual(1);
  });
});

describe("WAY_LABELS", () => {
  it("has a button-style label for every way in with a URL", () => {
    expect(Object.keys(WAY_LABELS).sort()).toEqual(Object.keys(WAYS_IN).sort());
  });
});
