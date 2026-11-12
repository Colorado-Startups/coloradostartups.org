import { describe, expect, it } from "vitest";

import { HALL_ART_ALT } from "../../../src/components/art/keepers";
import { contentPages } from "../pages";

// #714: the Great Hall picture (hero/hall) shows dwarf and gnome keepers, so
// every built page that shows it gives the same alt, which says they are AI
// agents (.claude/rules/ai-disclosure.md). Built HTML from dist/.

const shown = contentPages().flatMap((p) =>
  [...new DOMParser().parseFromString(p.html, "text/html").querySelectorAll('[data-art="hero/hall"] img')].map(
    (img) => [p.route, img.getAttribute("alt")] as const,
  ),
);

describe("the Great Hall picture", () => {
  it("appears on the home page, the dispatches and the seat pages, at least", () => {
    const routes = new Set(shown.map(([route]) => route));
    expect(routes.has("/")).toBe(true);
    expect([...routes].some((r) => r.startsWith("/dispatches/") && r !== "/dispatches/")).toBe(true);
    expect(routes.size).toBeGreaterThanOrEqual(5);
  });

  it.each(shown)("%s: its alt discloses the keepers as AI agents", (_route, alt) => {
    expect(alt).toBe(HALL_ART_ALT);
    expect(alt).toMatch(/AI agents/);
  });
});
