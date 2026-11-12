// Self-test for css.ts, the rule reader the page polish tests rely on. It
// seeds known CSS, in the minified shape Astro ships, and checks each answer.
import { describe, expect, it } from "vitest";

import { cssRules, declFor, normalizeSelector, rulesFor } from "./css";

const SHIPPED =
  ".prose[data-astro-cid-ab12] h2:first-of-type+ul{padding:24px;background:var(--c-surface)}" +
  ".a:is(.b,.c)>p,.d{margin:0}" +
  "@media (min-width:40rem){.prose[data-astro-cid-ab12] h2:first-of-type+ul{background:red}.e{color:blue}}" +
  "@supports (corner-shape: bevel){.prose[data-astro-cid-ab12] h2:first-of-type+ul{corner-shape:bevel}}" +
  ".prose[data-astro-cid-ab12] h2:first-of-type+ul{background:var(--c-ground)}";

describe("css.ts, the rule reader", () => {
  it("removes Astro's scoping and spaces each combinator the same way", () => {
    expect(normalizeSelector(".prose[data-astro-cid-ab12] h2:first-of-type+ul")).toBe(".prose h2:first-of-type + ul");
    expect(normalizeSelector(".prose  h2:first-of-type + ul")).toBe(".prose h2:first-of-type + ul");
  });

  it("splits a selector list at top-level commas only", () => {
    expect(cssRules(SHIPPED)[1]!.selectors).toEqual([".a:is(.b,.c) > p", ".d"]);
  });

  it("records the at-rule around each rule", () => {
    const ats = rulesFor(SHIPPED, ".prose h2:first-of-type + ul").map((r) => r.at);
    expect(ats).toEqual(["", "@media (min-width:40rem)", "@supports (corner-shape:bevel)", ""]);
    expect(rulesFor(SHIPPED, ".e")[0]!.at).toBe("@media (min-width:40rem)");
  });

  it("gives the last value outside at-rules, and a value inside one when asked", () => {
    expect(declFor(SHIPPED, ".prose h2:first-of-type + ul", "background")).toBe("var(--c-ground)");
    expect(declFor(SHIPPED, ".prose h2:first-of-type + ul", "corner-shape", "@supports (corner-shape:bevel)")).toBe(
      "bevel",
    );
    expect(declFor(SHIPPED, ".prose h2:first-of-type + ul", "corner-shape")).toBeUndefined();
  });

  it("finds nothing for a selector the CSS does not name", () => {
    expect(rulesFor(SHIPPED, ".prose h2 + ul")).toEqual([]);
    expect(declFor(SHIPPED, ".nowhere", "color")).toBeUndefined();
  });
});
