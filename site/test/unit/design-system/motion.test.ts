import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countUp, countUpAttrs } from "../../../src/components/home/count-up";

// Step W1, the CSS motion system in src/styles/global.css. jsdom has no
// layout or animation, so this reads the CSS source and checks that each
// effect sits inside its guard:
// - page transitions only under prefers-reduced-motion: no-preference, and
//   switched off again under reduce;
// - reveals and count-up only behind @supports (animation-timeline: view());
// - the figures on ExploreTile and StatTile stay plain text in the markup.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = read("../../../src/styles/global.css");
const EXPLORE = read("../../../src/components/home/ExploreTile.astro");
const STAT = read("../../../src/components/home/StatTile.astro");

interface Block {
  /** The rule or at-rule head, such as "@media (...)" or ".a, .b". */
  head: string;
  /** The heads of every enclosing block, outermost first. */
  within: string[];
  /** Declarations directly in this block, nested blocks removed. */
  body: string;
  /** The head and braces as written. */
  raw: string;
}

// Every block at any depth, with the at-rules and rules around it.
function blocks(css: string, within: string[] = []): Block[] {
  const out: Block[] = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    if (css[i] === "{") {
      const head = css.slice(start, i).trim();
      let depth = 1;
      let j = i + 1;
      while (depth && j < css.length) {
        if (css[j] === "{") depth++;
        if (css[j] === "}") depth--;
        j++;
      }
      const inner = css.slice(i + 1, j - 1);
      const children = blocks(inner, [...within, head]);
      let body = inner;
      for (const c of children.filter((c) => c.within.length === within.length + 1)) body = body.replace(c.raw, "");
      out.push({ head, within, body, raw: css.slice(start, j) });
      out.push(...children);
      i = j;
      start = j;
    } else {
      if (css[i] === "}" || css[i] === ";") start = i + 1;
      i++;
    }
  }
  return out;
}

const ALL = blocks(CSS);
const NO_PREF = "@media (prefers-reduced-motion: no-preference)";
const REDUCE = "@media (prefers-reduced-motion: reduce)";
const SUPPORTS_VIEW = /^@supports .*\(animation-timeline: view\(\)\) and \(animation-range: entry\)/;

const where = (pred: (b: Block) => boolean) => ALL.filter(pred);
const hasDecl = (b: Block, prop: string) => new RegExp(`(?:^|[;\\s])${prop}\\s*:`).test(b.body);

describe("motion test reader (self-test)", () => {
  it("records the guards around a nested rule", () => {
    const [outer, inner, rule] = blocks("@media (a) { @supports (b) { .x { color: red; } } }");
    expect(outer!.head).toBe("@media (a)");
    expect(inner!.within).toEqual(["@media (a)"]);
    expect(rule!.within).toEqual(["@media (a)", "@supports (b)"]);
    expect(rule!.body.trim()).toBe("color: red;");
  });
});

describe("page transitions (W1.1)", () => {
  it("opts in with navigation: auto only inside prefers-reduced-motion: no-preference", () => {
    const optIns = where((b) => b.head === "@view-transition" && /navigation:\s*auto/.test(b.body));
    expect(optIns.length).toBe(1);
    for (const b of optIns) expect(b.within).toEqual([NO_PREF]);
  });

  it("styles view-transition pseudo-elements only behind a motion media query", () => {
    for (const b of where((b) => b.head.includes("::view-transition"))) {
      expect([NO_PREF, REDUCE]).toContain(b.within[0]);
    }
  });

  it("switches page transitions off in the reduced-motion block", () => {
    const off = where((b) => b.head === "@view-transition" && b.within[0] === REDUCE);
    expect(off.map((b) => b.body.trim())).toEqual(["navigation: none;"]);
    const stop = where((b) => b.within[0] === REDUCE && b.head.includes("::view-transition-group(*)"));
    expect(stop.length).toBe(1);
    expect(stop[0]!.body).toMatch(/animation:\s*none !important/);
  });

  it("names no morphs between pages yet", () => {
    expect(CSS).not.toMatch(/view-transition-name/);
  });
});

describe("scroll reveals and count-up (W1.2, W1.3)", () => {
  it("runs every view timeline behind @supports, inside no-preference", () => {
    const timed = where((b) => hasDecl(b, "animation-timeline"));
    expect(timed.length).toBeGreaterThanOrEqual(2);
    for (const b of timed) {
      expect(b.within[0], b.head).toBe(NO_PREF);
      expect(b.within[1], b.head).toMatch(SUPPORTS_VIEW);
    }
  });

  it("keeps the reveal and count-up rules and keyframes inside the guard", () => {
    const guarded = (b: Block) => b.within[0] === NO_PREF && SUPPORTS_VIEW.test(b.within[1] ?? "");
    for (const head of ["[data-reveal]", "@keyframes reveal", "[data-count-up]", "@keyframes count-up"]) {
      const found = where((b) => b.head === head);
      expect(found.length, head).toBe(1);
      expect(guarded(found[0]!), head).toBe(true);
    }
    for (const b of where((b) => b.head.includes("data-count-groups"))) expect(guarded(b), b.head).toBe(true);
  });

  it("never hides a revealed element outside the guard", () => {
    for (const b of where((b) => b.head.includes("[data-reveal]") && /opacity|translate|visibility/.test(b.body))) {
      expect(b.within[1]).toMatch(SUPPORTS_VIEW);
    }
  });

  it("gives the counting copy empty alt text, so screen readers read the real number", () => {
    const copies = where((b) => /data-count-groups="\d"\]::after/.test(b.head));
    expect(copies.length).toBe(4);
    for (const b of copies) expect(b.body).toMatch(/\/ ""\s*;/);
  });

  it("ends the count when the figure is fully in view, so none stops on a partial number", () => {
    const counters = where((b) => b.head === "[data-count-up]");
    expect(counters.length).toBe(1);
    expect(counters[0].body).toMatch(/animation-range:\s*entry 0% entry 100%\s*;/);
  });

  it("never replaces or recolors the real number's text", () => {
    for (const b of where((b) => b.head.includes(".count__text"))) {
      expect(b.body).not.toMatch(/content\s*:|color\s*:|display\s*:\s*none|visibility/);
    }
  });
});

describe("figures stay plain text (W1.3)", () => {
  it("renders the count and the value as text inside .count__text", () => {
    expect(EXPLORE).toMatch(/<span class="count__text">\{count\}<\/span>/);
    expect(STAT).toMatch(/<span class="count__text">\{value\}<\/span>/);
  });

  it("never hides the figure or moves it into an attribute only", () => {
    for (const src of [EXPLORE, STAT]) {
      expect(src).not.toMatch(/aria-hidden[^>]*count__text|count__text[^>]*aria-hidden/);
      expect(src).not.toMatch(/data-value=|content:\s*attr/);
    }
  });

  it("counts whole numbers and leaves decimals, ordinals and words still", () => {
    expect(countUp(42)).toEqual({
      to: 42,
      from: 0,
      groups: 1,
      prefix: "",
      suffix: "",
    });
    expect(countUp("82%")).toMatchObject({ to: 82, suffix: "%" });
    expect(countUp("$600,000")).toMatchObject({
      to: 600000,
      from: 1000,
      groups: 2,
      prefix: "$",
    });
    expect(countUp("6,012,561")).toMatchObject({
      to: 6012561,
      from: 1000000,
      groups: 3,
    });
    for (const v of ["34.7%", "13th", "2 billion", "20 million+", "", "3,00"]) expect(countUp(v), v).toBeNull();
  });

  it("passes only numbers and the plain prefix and suffix to the CSS", () => {
    const attrs = countUpAttrs(countUp("143,807")!);
    expect(attrs.style).toBe("--count-from: 1000; --count-to: 143807");
    expect(attrs["data-count-groups"]).toBe("2");
  });
});
