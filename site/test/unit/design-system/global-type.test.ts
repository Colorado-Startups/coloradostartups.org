import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Type and button-row rules in src/styles/global.css that no visual test
// watches. jsdom has no layout, so these read the CSS source:
// - #202: body copy wraps pretty, h3 and h4 wrap balanced.
// - #208: h3 is 21 px on a phone and 24 px from 48rem up, both on the scale.
// - #257: on a phone, buttons in a .btn-row grow to fill their line.

const CSS = readFileSync(new URL("../../../src/styles/global.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

interface Rule {
  media: string | null;
  selectors: string[];
  body: string;
}

// Top-level rules and rules one level inside an @media block.
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    if (head.startsWith("@media")) {
      let depth = 1;
      let j = open + 1;
      while (depth && j < css.length) {
        if (css[j] === "{") depth++;
        if (css[j] === "}") depth--;
        j++;
      }
      for (const r of rules(css.slice(open + 1, j - 1))) out.push({ ...r, media: head });
      i = j;
    } else {
      const close = css.indexOf("}", open);
      out.push({ media: null, selectors: head.split(",").map((s) => s.trim()), body: css.slice(open + 1, close) });
      i = close + 1;
    }
  }
  return out;
}

const value = (r: Rule, prop: string) => new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(r.body)?.[1].trim();

function find(css: string, selector: string, prop: string, media: string | null): string[] {
  return rules(css)
    .filter((r) => r.media === media && r.selectors.includes(selector))
    .map((r) => value(r, prop))
    .filter((v): v is string => v !== undefined);
}

describe("global.css rule reader (self-test)", () => {
  it("tells a media rule from a top-level one", () => {
    const css = "h3 { font-size: 1px; } @media (min-width: 2rem) { h3 { font-size: 2px; } }";
    expect(find(css, "h3", "font-size", null)).toEqual(["1px"]);
    expect(find(css, "h3", "font-size", "@media (min-width: 2rem)")).toEqual(["2px"]);
  });
});

describe("global.css type (#202, #208)", () => {
  it("wraps body copy pretty and h3 and h4 balanced", () => {
    for (const s of ["p", "li", ".lede"]) expect(find(CSS, s, "text-wrap", null), s).toEqual(["pretty"]);
    for (const s of ["h3", "h4"]) expect(find(CSS, s, "text-wrap", null), s).toEqual(["balance"]);
  });

  it("steps h3 from 21 px on a phone to 24 px from 48rem", () => {
    expect(find(CSS, "h3", "font-size", null)).toEqual(["var(--t-step-1)"]);
    expect(find(CSS, "h3", "font-size", "@media (min-width: 48rem)")).toEqual(["var(--t-step-2)"]);
  });
});

describe("global.css button rows (#257)", () => {
  it("gives each button but a quiet one a line of its own on a phone (#762)", () => {
    // 100%, not auto: with auto, two short buttons shared a line only when
    // their words fitted, so a web-font swap could break the line.
    expect(find(CSS, ".btn-row > .btn:not(.btn--quiet)", "flex", "@media (max-width: 30rem)")).toEqual(["1 1 100%"]);
  });
});
