import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Two cascade rules in src/styles/hall.css that a reorder or a quick edit can
// break without any visual test noticing:
// 1. The pressed button rule comes after every variant's hover rule. A press
//    is also a hover and both weigh the same, so the later rule wins.
// 2. Materials set --focus-ring on their children, never on themselves, so a
//    card's own ring (drawn on the band outside it) keeps the band's color.

const HALL = readFileSync(new URL("../../../src/styles/hall.css", import.meta.url), "utf8");

interface Rule {
  selector: string;
  body: string;
  at: number;
}

function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length));
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
    at: m.index ?? 0,
  }));
}

// The pressed rule thins the ledge to a hairline: 0 var(--line-hair) 0 var(--_ledge).
const PRESSED_LEDGE = /0 var\(--line-hair\) 0 var\(--_ledge\)/;

function pressedAfterHovers(css: string): boolean {
  const all = rules(css);
  const pressed = all.find((r) => r.selector === ".btn:active" && PRESSED_LEDGE.test(r.body));
  if (!pressed) return false;
  const hovers = all.filter((r) => /\.btn--[\w-]+:hover/.test(r.selector) && r.body.includes("box-shadow"));
  return hovers.every((h) => h.at < pressed.at);
}

// Splits a selector list on its top-level commas, so :is(a, b) stays whole.
function selectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  return [...parts, current.trim()];
}

function materialsSetOwnRing(css: string): string[] {
  return rules(css)
    .filter((r) => /(^|[;\s])--focus-ring\s*:/.test(r.body))
    .filter((r) => selectorList(r.selector).some((part) => !part.endsWith("> *")))
    .map((r) => r.selector);
}

describe("hall.css cascade (self-test)", () => {
  it("catches the old order, where a gold hover ledge outlived the press", () => {
    const bad = `.btn:active { box-shadow: inset 0 var(--line-hair) 0 var(--_glint), 0 var(--line-hair) 0 var(--_ledge); }
      .btn--gold:hover { box-shadow: inset 0 var(--line-hair) 0 var(--_glint), 0 var(--size-ledge) 0 var(--_ledge); }`;
    expect(pressedAfterHovers(bad)).toBe(false);
  });

  it("passes the fixed order, where the press comes after the hover", () => {
    const clean = `.btn--gold:hover { box-shadow: inset 0 var(--line-hair) 0 var(--_glint), 0 var(--size-ledge) 0 var(--_ledge); }
      .btn:active { box-shadow: inset 0 var(--line-hair) 0 var(--_glint), 0 var(--line-hair) 0 var(--_ledge); }`;
    expect(pressedAfterHovers(clean)).toBe(true);
  });

  it("catches a material that sets its own focus ring", () => {
    expect(materialsSetOwnRing(".hall-card--night { --focus-ring: var(--c-focus-on-night); }")).toHaveLength(1);
  });
});

describe("hall.css cascade", () => {
  it("puts the pressed rule after every button hover rule that sets a shadow", () => {
    expect(pressedAfterHovers(HALL)).toBe(true);
  });

  it("sets --focus-ring only on a material's children", () => {
    expect(materialsSetOwnRing(HALL)).toEqual([]);
  });
});
