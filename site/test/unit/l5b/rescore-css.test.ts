import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// L5b, design re-score rows (#723): the home page's Start here pair stretches
// to one height, as /community/'s does (#213), and a /get-involved/ seat card
// ends at its content. The e2e specs measure both; this guards the rules.

const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), "utf8");
const style = (src: string) => /<style[^>]*>([\s\S]*?)<\/style>/.exec(src)?.[1] ?? "";
const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("design re-score rows (#723)", () => {
  it("lets the home Start here pair stretch to one height", () => {
    const pair = rule(style(read("pages/index.astro")), ".pair");
    expect(pair).toMatch(/display:\s*grid/);
    expect(pair).not.toMatch(/align-items/);
  });

  it("ends each /get-involved/ seat card at its content", () => {
    expect(rule(style(read("pages/get-involved/index.astro")), ".seat-grid")).toMatch(/align-items:\s*start/);
  });
});
