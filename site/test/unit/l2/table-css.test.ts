import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The board's source links are small text links stacked in one cell, about
// 189 of them on the page. Without a minimum height each is an 18 px row and
// fails WCAG 2.2 SC 2.5.8 Target Size (Minimum) at 375 px (#119). e2e/l2.spec.ts
// measures the rendered boxes; this keeps the rule from going missing in CI,
// which runs no browser.

const TABLE = readFileSync(new URL("../../../src/components/leaderboard/HonoreesTable.astro", import.meta.url), "utf8");
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(TABLE)?.[1] ?? "";

function body(selector: string): string {
  const text = STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return "";
}

describe("HonoreesTable source links", () => {
  it("are at least 24 px tall, from the 24 px spacing token", () => {
    expect(body(".sources a")).toMatch(/min-height:\s*var\(--s-5\)/);
  });

  it("center their text in that height", () => {
    expect(body(".sources a")).toMatch(/display:\s*inline-flex/);
    expect(body(".sources a")).toMatch(/align-items:\s*center/);
  });

  // Their hidden " for <company>" labels are position: absolute. Without a
  // positioned scroll box they escape it and widen the page at 375 px (#242).
  it("keep their hidden labels inside the table's scroll box", () => {
    expect(body(".scroll")).toMatch(/position:\s*relative/);
    expect(body(".scroll")).toMatch(/overflow-x:\s*auto/);
  });

  it("self-test: finds no rule for a selector the style lacks", () => {
    expect(body(".no-such-rule")).toBe("");
  });
});

// The five sort buttons once showed no hover change, and only the sorted
// column carried an arrow, so the other four did not look sortable. The text
// alone made a 23 px tall target at 375 px (#241). e2e/l2.spec.ts checks the
// rendered result.
describe("HonoreesTable sort buttons", () => {
  const MARKUP = TABLE.slice(0, TABLE.indexOf("<style>"));

  it("underline on hover", () => {
    expect(body("thead button:hover")).toMatch(/text-decoration:\s*underline/);
  });

  it("mark a column that is not sorted with a dim up and down arrow", () => {
    expect(body(".sort-icon::after")).toMatch(/content:\s*"\\2195"/);
    expect(body(".sort-icon::after")).toMatch(/color:\s*var\(--c-text-dim\)/);
    expect(body('th[aria-sort="ascending"] .sort-icon::after')).toMatch(/content:\s*"\\25B2"/);
    expect(body('th[aria-sort="descending"] .sort-icon::after')).toMatch(/content:\s*"\\25BC"/);
  });

  // Generated content counts toward a button's accessible name. In an
  // aria-hidden span it does not, so the name stays the column's label and
  // aria-sort alone says the order.
  it("draw the arrow inside an aria-hidden span, never on the button itself", () => {
    expect(MARKUP).toMatch(/<span class="sort-icon" aria-hidden="true"/);
    expect(STYLE).not.toMatch(/button::(?:after|before)/);
  });

  it("are at least 44 px tall, from the tap target token", () => {
    expect(body("thead button")).toMatch(/min-height:\s*var\(--size-tap\)/);
  });

  // The cell has no padding inside an overflow-x box, so an outset ring loses
  // its left side on the first column. An inset ring draws all four sides.
  it("draw the focus ring inside the button", () => {
    expect(body("thead button:focus-visible")).toMatch(/outline-offset:\s*calc\(-1 \* var\(--line-bold\)\)/);
  });
});
