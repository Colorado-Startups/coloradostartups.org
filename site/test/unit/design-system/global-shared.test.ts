import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Shared classes in src/styles/global.css that pages adopt (#217, #259).
// jsdom has no layout, so these read the CSS source.

const CSS = readFileSync(new URL("../../../src/styles/global.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the first rule for `selector`, inside the @media block `media` when given. */
function body(css: string, selector: string, media?: string): string | undefined {
  let scope = css;
  if (media) {
    const at = css.indexOf(`${media} {`);
    if (at < 0) return undefined;
    let depth = 0;
    let end = at;
    for (let i = css.indexOf("{", at); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    scope = css.slice(css.indexOf("{", at) + 1, end);
  }
  for (const m of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2];
  }
  return undefined;
}

/** The bodies of every rule in `css` whose selector names .crumbs. */
function crumbsRules(css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.crumbs\b/.test(m[1])).map((m) => m[2]);
}

describe("global.css rule reader (self-test)", () => {
  it("reads a rule inside a media block and not outside it", () => {
    const css = ".a { color: red; } @media (max-width: 1rem) { .b { color: blue; } }";
    expect(body(css, ".b", "@media (max-width: 1rem)")).toContain("blue");
    expect(body(css, ".a", "@media (max-width: 1rem)")).toBeUndefined();
  });
});

describe("global.css shared classes", () => {
  it("has one kicker style, in the page's link ink, with a gold bar (#217)", () => {
    const k = body(CSS, ".kicker");
    expect(k).toMatch(/font-size:\s*var\(--t-step--1\)/);
    expect(k).toMatch(/color:\s*var\(--ink-link, var\(--c-link\)\)/);
    expect(body(CSS, ".kicker::before")).toMatch(/background:\s*var\(--c-accent\)/);
  });

  // (?![\w-]), not \b: \b would also count .tap-target-foo.
  const tapTargets = (css: string) => css.match(/\.tap-target(?![\w-])/g) ?? [];

  it("counts .tap-target and nothing that only starts with it (self-test)", () => {
    expect(tapTargets(".tap-target, .crumbs a { min-height: 1px }")).toHaveLength(1);
    expect(tapTargets(".tap-target-foo { } .tap-targets { } .tap-target_x { }")).toHaveLength(0);
  });

  it("makes a standalone link a 44 px target on a phone (#259)", () => {
    // One rule only, and it sits in the phone media block.
    expect(tapTargets(CSS)).toHaveLength(1);
    expect(body(CSS, ".tap-target", "@media (max-width: 40rem)")).toMatch(/min-height:\s*var\(--size-tap\)/);
    expect(readFileSync(new URL("../../../src/styles/tokens.css", import.meta.url), "utf8")).toMatch(/--size-tap:\s*44px;/);
  });

  it("has one breadcrumb style, whose links are 44 px targets on a phone (#195, #259)", () => {
    expect(body(CSS, ".crumbs ol")).toMatch(/list-style:\s*none/);
    expect(body(CSS, ".crumbs li + li::before")).toMatch(/content:\s*"\/"/);
    expect(body(CSS, ".crumbs a", "@media (max-width: 40rem)")).toMatch(/min-height:\s*var\(--size-tap\)/);
    // No component or page keeps a copy: a file that draws a breadcrumb may
    // set its own .crumbs margins, and nothing else.
    for (const file of [
      "components/guides/GuidePage.astro",
      "components/seats/seats.css",
      "pages/guides/startup-credits.astro",
      "pages/regions/[id].astro",
    ]) {
      const src = readFileSync(new URL(`../../../src/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, file).not.toMatch(/crumbs li \+ li::before/);
      for (const rule of crumbsRules(src)) expect(rule, file).toMatch(/^(\s*margin(-[a-z]+)?:[^;]+;)*\s*$/);
    }
  });

  it("reads a file's .crumbs rules (self-test)", () => {
    expect(crumbsRules(".crumbs ol { margin: 0 0 var(--s-3); } .seat-hero .crumbs { margin-bottom: 1rem; }")).toHaveLength(2);
    // A copy of the look fails the margins-only check above.
    expect(crumbsRules(".crumbs ol { display: flex; margin: 0; }")[0]).not.toMatch(/^(\s*margin(-[a-z]+)?:[^;]+;)*\s*$/);
  });
});
