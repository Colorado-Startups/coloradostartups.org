import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The cards view's CSS (honorees-cards.css). CI runs no browser here, so
// these keep the rules that hold it at 375 px and keep hidden rows hidden.
const CSS = readFileSync(new URL("../../../src/components/leaderboard/honorees-cards.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
function rule(selector: string): string {
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return "";
}

describe("honorees-cards.css", () => {
  it("lays the rows out as a grid whose columns never pass the screen's width", () => {
    expect(rule('.board[data-view="cards"] tbody')).toMatch(/display:\s*grid/);
    expect(rule('.board[data-view="cards"] tbody')).toMatch(/minmax\(min\(100%,\s*18rem\),\s*1fr\)/);
    expect(rule('.board[data-view="cards"] .scroll')).toMatch(/overflow-x:\s*visible/);
  });

  it("keeps a filtered-out card hidden, and the switch hidden until its script runs", () => {
    expect(rule('.board[data-view="cards"] tbody tr[hidden]')).toMatch(/display:\s*none/);
    expect(rule(".board-view[hidden]")).toMatch(/display:\s*none/);
  });

  it("gives each switch button the 44 px tap target, and marks the pressed one", () => {
    expect(rule(".board-view__option")).toMatch(/min-height:\s*var\(--size-tap\)/);
    expect(rule('.board-view__option[aria-pressed="true"]')).toMatch(/box-shadow/);
  });

  it("uses brand tokens only, no raw colors", () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("self-test: finds no rule for a selector the file lacks", () => {
    expect(rule(".no-such-rule")).toBe("");
  });
});
