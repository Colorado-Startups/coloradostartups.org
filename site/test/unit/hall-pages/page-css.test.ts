import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Layout rules from the November design review that no visual test watches.
// jsdom has no layout, so these read the CSS source:
// - #207: .hall-grid collapses empty tracks (auto-fit), so a row of three
//   spans the row at 1280 px.
// - #213: /community/'s narrow .pair track is minmax(0, 1fr). A bare 1fr
//   grows to the newsletter panel's widest content and loses the gutter.
// - #215, #216: /data/'s credit text is on the type scale, and its fields
//   stack on a phone.
// - #219: /founders/ leaves its h2 size to global.css, so one level has one size.
// - #237: the h1 floor is 36 px, and the guides drop their 10vw override.
// - #244: checkboxes and radios are sized in rem.

const read = (path: string) => readFileSync(new URL(`../../../src/${path}`, import.meta.url), "utf8");
const styleOf = (astro: string) => [...astro.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

interface Rule {
  selectors: string[];
  body: string;
}

function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()),
    body: m[2],
  }));
}

const declarations = (css: string, selector: string, property: string) =>
  rules(css)
    .filter((r) => r.selectors.includes(selector))
    .flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].trim()));

/** A track list with a bare fr track, the kind that grows to its content's min width. */
const hasBareFr = (tracks: string) => /\d+fr\b/.test(tracks.replace(/minmax\([^)]*\)/g, ""));

describe("page CSS helpers (self-test)", () => {
  it("finds a bare 1fr track and passes minmax(0, 1fr)", () => {
    expect(hasBareFr("1fr")).toBe(true);
    expect(hasBareFr("repeat(2, 1fr)")).toBe(true);
    expect(hasBareFr("minmax(0, 1fr)")).toBe(false);
    expect(hasBareFr("repeat(2, minmax(0, 1fr))")).toBe(false);
  });

  it("reads declarations inside a media query", () => {
    expect(declarations("@media (max-width: 1px) { .a, .b { color: red; } }", ".b", "color")).toEqual(["red"]);
  });
});

describe("hall.css card grid (#207)", () => {
  it("collapses empty tracks with auto-fit", () => {
    const tracks = declarations(read("styles/hall.css"), ".hall-grid", "grid-template-columns");
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatch(/^repeat\(auto-fit,/);
  });
});

describe("/community/ panels (#213)", () => {
  const css = styleOf(read("pages/community/index.astro"));

  it("never gives .pair a bare fr track", () => {
    const tracks = declarations(css, ".pair", "grid-template-columns");
    expect(tracks.length).toBeGreaterThan(1);
    for (const t of tracks) expect(hasBareFr(t), t).toBe(false);
  });

  it("lets the two panels stretch to one height", () => {
    expect(declarations(css, ".pair", "align-items")).toEqual([]);
  });
});

describe("/data/ credit and fields (#215, #216)", () => {
  const css = styleOf(read("pages/data/index.astro"));

  it("sets the credit text on the type scale", () => {
    expect(declarations(css, ".data-credit", "font-size")).toEqual(["var(--t-step--1)"]);
  });

  it("uses spacing and radius tokens in the credit box", () => {
    for (const p of ["padding", "border-radius"]) {
      for (const v of declarations(css, ".data-credit", p)) expect(v, p).toMatch(/^(var\(--[\w-]+\)\s*)+$/);
    }
  });

  it("stacks every field on a phone", () => {
    expect(declarations(css, ".data-fields div", "flex-direction")).toEqual(["column"]);
  });
});

describe("global.css page titles and form controls (#237, #244)", () => {
  const css = read("styles/global.css");

  it("gives h1 a 36 px floor, so one long word fits a 375 px phone", () => {
    expect(declarations(css, "h1", "font-size")).toEqual(["clamp(var(--t-step-3), 6vw + 0.75rem, var(--t-step-6))"]);
  });

  it("leaves the guide titles to the global h1 size", () => {
    for (const page of ["components/guides/GuidePage.astro", "pages/guides/startup-credits.astro"]) {
      expect(declarations(styleOf(read(page)), "h1", "font-size"), page).toEqual([]);
    }
  });

  it("sizes checkboxes and radios in rem, not the control font's em", () => {
    // The size is the --size-check token (#330), which must stay in rem.
    expect(read("styles/tokens.css")).toMatch(/--size-check:\s*1\.25rem;/);
    for (const p of ["width", "height"]) {
      expect(declarations(css, 'input[type="checkbox"]', p), p).toEqual(["var(--size-check)"]);
      expect(declarations(css, 'input[type="radio"]', p), p).toEqual(["var(--size-check)"]);
    }
  });
});

describe("/founders/ headings (#219)", () => {
  it("leaves h2 sizes to global.css", () => {
    const css = styleOf(read("pages/founders/index.astro"));
    const overrides = rules(css).filter((r) => r.selectors.some((s) => /(^|\s)h2$/.test(s)) && /font-size/.test(r.body));
    expect(overrides).toEqual([]);
  });
});
