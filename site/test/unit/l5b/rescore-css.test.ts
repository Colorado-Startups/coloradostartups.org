import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// L5b, design re-score rows (#723): a /get-involved/ seat card ends at its
// content. The home page's Start here pair left with the redesign (2026-11-15).

const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), "utf8");
const style = (src: string) => /<style[^>]*>([\s\S]*?)<\/style>/.exec(src)?.[1] ?? "";
const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("design re-score rows (#723)", () => {
  it("ends each /get-involved/ seat card at its content", () => {
    expect(rule(style(read("pages/get-involved/index.astro")), ".seat-grid")).toMatch(/align-items:\s*start/);
  });
});
