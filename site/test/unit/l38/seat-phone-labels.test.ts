// L38: every label in a seat map or network diagram draws at 15 px or more,
// the type scale's smallest step, on every screen from 360 to 1600 px: on a
// phone (#329) and in the two-column layout (#367). Computed here, so CI
// checks it without a browser; e2e/l38.spec.ts measures the same in Chrome.
//
// Up to 45.625rem the page shows each figure's phone drawing, 310 units wide,
// at its own width inside a 1 px border (seats.css). Wider, it shows the
// 680-unit drawing (560 for the statewide map) across its split's first
// column, up to the cap on .seat-figure__wide. A label draws at its CSS size
// x the drawing's shown content width / its viewBox width. The column comes
// from the .seat-split and .seat-split--figure rules that apply on the
// screen, resolved inside global.css's .wrap. A label's CSS size comes from
// seats.css: the rules outside any @media block plus those whose max-width
// covers the screen, settled by a small cascade (class specificity, then
// order).
import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { loadGeo } from "../../../src/lib/seats/load";
import { frontRangeMap, networkDiagram, PHONE_TYPE, SEAT_NARROW_WIDTH, type MapRegion, type NetworkSeat } from "../../../src/lib/seats/viz";
import { BLOCKS, columnsPx, declsAt, GUTTERS, lengthPx, SEATS_CSS as CSS, valueOf, WRAP_MAX, wrapAt } from "./css";

const FLOOR = 15;
const BORDER = 2; // seats.css: the figure's 1 px border, both sides

const TOKENS = readFileSync(new URL("../../../src/styles/tokens.css", import.meta.url), "utf8");
const px = (token: string) => Number(new RegExp(`--${token}:\\s*([\\d.]+)rem`).exec(TOKENS)?.[1]) * 16;
/** The widest screen, in px, that shows the phone drawings. */
const SWAP = Number(/@media \(max-width: ([\d.]+)rem\) \{\s*\.seat-figure__wide \{\s*display: none/.exec(CSS)?.[1]) * 16;

interface Rule {
  ancestor: string[];
  own: string[];
  token: string;
  order: number;
}

/** The font-size rules that apply on a screen `width` px wide, one per selector, in source order. */
function rulesAt(css: string, width: number): Rule[] {
  const rules: Rule[] = [];
  const add = (selectors: string, token: string) => {
    for (const selector of selectors.split(",")) {
      const parts = selector.trim().split(/\s+/);
      const classes = (part: string) => part.split(".").filter(Boolean);
      rules.push({ ancestor: parts.slice(0, -1).flatMap(classes), own: classes(parts.at(-1)!), token, order: rules.length });
    }
  };
  const fontRule = /([^{}@]+)\{[^{}]*font-size:\s*var\(--([\w-]+)\)[^{}]*\}/g;
  // Media blocks and plain rules in source order, as the cascade reads them.
  for (const m of css.matchAll(BLOCKS)) {
    if (m[1] !== undefined) {
      if (Number(m[1]) * 16 >= width) for (const r of m[2]!.matchAll(fontRule)) add(r[1]!, r[2]!);
    } else {
      const size = /font-size:\s*var\(--([\w-]+)\)/.exec(m[4]!);
      if (size) add(m[3]!, size[1]!);
    }
  }
  return rules;
}

/** The token a text gets: the matching rule with the most classes, the later one on a tie. */
function tokenFor(rules: readonly Rule[], own: readonly string[], root: readonly string[]): string | undefined {
  const matching = rules.filter((r) => r.own.every((c) => own.includes(c)) && r.ancestor.every((c) => root.includes(c)));
  matching.sort((a, b) => a.own.length + a.ancestor.length - (b.own.length + b.ancestor.length) || a.order - b.order);
  return matching.at(-1)?.token;
}

// seats.css reads the same between two of its breakpoints, so each run of
// screens parses it once.
const BREAKPOINTS = [...CSS.matchAll(/@media \(max-width: ([\d.]+)rem\)/g)].map((m) => Number(m[1]) * 16);
function onScreen<T>(cache: Map<string, T>, screen: number, read: () => T): T {
  const key = BREAKPOINTS.filter((b) => b >= screen).join();
  if (!cache.has(key)) cache.set(key, read());
  return cache.get(key)!;
}
const ruleCache = new Map<string, Rule[]>();
const splitCache = new Map<string, [string, string][]>();
const capCache = new Map<string, [string, string][]>();

/** The content width, inside its border, at which a figure's drawing shows on a screen `screen` px wide. */
function shownPx(screen: number, phone: boolean): number {
  const split = onScreen(splitCache, screen, () => declsAt(CSS, screen, [".seat-split", ".seat-split--figure"]));
  const column = columnsPx(valueOf(split, "grid-template-columns") ?? "none", wrapAt(screen), lengthPx(valueOf(split, "gap") ?? "none"))[0]!;
  if (phone) return Math.min(SEAT_NARROW_WIDTH, column - BORDER);
  const cap = valueOf(onScreen(capCache, screen, () => declsAt(CSS, screen, [".seat-figure__wide"])), "max-width");
  return Math.min(column, cap ? lengthPx(cap) : Infinity) - BORDER;
}

/** A drawing as the size check reads it: its root element, viewBox width, root classes and labels. */
interface Drawing {
  root: Element;
  width: number;
  classes: string[];
  labels: { text: string; own: string[] }[];
}
function drawing(markup: string): Drawing {
  const root = new JSDOM(markup, { contentType: "image/svg+xml" }).window.document.documentElement;
  return {
    root,
    width: Number(root.getAttribute("viewBox")?.split(" ")[2]),
    classes: (root.getAttribute("class") ?? "").split(/\s+/),
    labels: [...root.querySelectorAll("text")].map((t) => ({ text: t.textContent ?? "", own: (t.getAttribute("class") ?? "").split(/\s+/) })),
  };
}

const geo = loadGeo();
/** Each map and diagram: its name, its wide drawing and its phone drawing. */
const figures: [string, Drawing, Drawing][] = [
  ...(["all", "photon-mountain", "fusion-canyon", "space-peak"] as MapRegion[]).map(
    (r) => [`map ${r}`, drawing(frontRangeMap(r, geo)), drawing(frontRangeMap(r, geo, { narrow: true }))] as [string, Drawing, Drawing],
  ),
  ...(["slack-community-lead", "photon-mountain-connector", "fusion-canyon-connector", "space-peak-connector"] as NetworkSeat[]).map(
    (s) => [`network ${s}`, drawing(networkDiagram(s)), drawing(networkDiagram(s, { narrow: true }))] as [string, Drawing, Drawing],
  ),
];

/** The smallest label in `d` when it shows `shown` px wide on a screen `screen` px wide, if under 15 px. */
function smallestUnderFloor(d: Drawing, shown: number, screen: number): string | undefined {
  const rules = onScreen(ruleCache, screen, () => rulesAt(CSS, screen));
  let smallest: { drawn: number; text: string } | undefined;
  for (const { text, own } of d.labels) {
    const token = tokenFor(rules, own, d.classes);
    const drawn = token ? (px(token) * shown) / d.width : 0;
    if (drawn < FLOOR && (!smallest || drawn < smallest.drawn)) {
      smallest = { drawn, text: `${text} (${own.join(".")}): ${token ?? "no size"} ${drawn.toFixed(1)} px` };
    }
  }
  return smallest?.text;
}

describe("seat figure labels", () => {
  it("self-test: the cascade picks the most specific rule, then the later one, and media by width", () => {
    const css = ".a, .b { font-size: var(--t-step--1); } .root .a { font-size: var(--t-step-0); } @media (max-width: 40rem) { .b { font-size: var(--t-step-2); } }";
    expect(tokenFor(rulesAt(css, 375), ["a"], ["sv"])).toBe("t-step--1");
    expect(tokenFor(rulesAt(css, 375), ["a"], ["root"])).toBe("t-step-0");
    expect(tokenFor(rulesAt(css, 375), ["b"], ["sv"])).toBe("t-step-2");
    expect(tokenFor(rulesAt(css, 700), ["b"], ["sv"])).toBe("t-step--1");
    expect(tokenFor(rulesAt(css, 375), ["c"], ["sv"])).toBeUndefined();
    expect(px("t-step--1")).toBe(15);
  });

  it("self-test: reads a split's columns from its rules, later and narrower ones winning", () => {
    const css = ".s { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-6); } @media (max-width: 52rem) { .s { grid-template-columns: minmax(0, 1fr); } } .f { grid-template-columns: 43rem minmax(0, 1fr); }";
    const at = (screen: number, selectors: string[]) => {
      const d = declsAt(css, screen, selectors);
      return columnsPx(valueOf(d, "grid-template-columns")!, Math.min(screen - GUTTERS, 1180), lengthPx(valueOf(d, "gap")!));
    };
    expect(at(900, [".s"])).toEqual([410, 410]);
    expect(at(800, [".s"])).toEqual([752]);
    expect(at(1280, [".s", ".f"])).toEqual([688, 460]);
    expect(() => lengthPx("auto")).toThrow();
    expect([WRAP_MAX, SWAP]).toEqual([1180, 730]);
  });

  // The wide drawing shows inside the gutters and its own border: without the
  // border, a 729 px screen showed it 679 px wide, at 14.98 px labels (#374).
  it("shows the phone drawing wherever the 680-unit drawing would draw smaller than its units", () => {
    expect(SWAP).toBeGreaterThanOrEqual(680 + GUTTERS + BORDER);
  });

  // viz.ts places a phone diagram's labels from box estimates at PHONE_TYPE's
  // sizes, read from the type tokens. They must be the sizes seats.css gives
  // those classes in a phone drawing, or the boxes drift from the text (#374).
  it("estimates phone label boxes at the sizes seats.css sets", () => {
    const rules = rulesAt(CSS, 375);
    const root = /<svg class="([^"]+)"/.exec(networkDiagram("slack-community-lead", { narrow: true }))![1]!.split(" ");
    const size = (own: string[]) => px(tokenFor(rules, own, root) ?? "none");
    expect({
      label: size(["sv-label", "sv-node", "sv-halo"]),
      strong: size(["sv-label-strong", "sv-node-strong", "sv-halo"]),
      center: size(["sv-center", "sv-center-multi"]),
    }).toEqual(PHONE_TYPE);
  });

  it.each(figures)("%s has a 310-unit phone drawing at its own size", (_, __, phone) => {
    expect(phone.width).toBe(SEAT_NARROW_WIDTH);
    expect(phone.root.getAttribute("width")).toBe(String(SEAT_NARROW_WIDTH));
  });

  // Every screen width, so no band between two breakpoints slips through: in
  // the two-column layout the 680-unit drawings drew 9 to 12.7 px labels (#367).
  it.each(figures)("%s draws every label at 15 px or more on every screen from 360 to 1600 px", (_, wide, phone) => {
    const failing: string[] = [];
    for (let screen = 360; screen <= 1600; screen++) {
      const isPhone = screen <= SWAP;
      const small = smallestUnderFloor(isPhone ? phone : wide, shownPx(screen, isPhone), screen);
      if (small) failing.push(`${screen} px: ${small}`);
    }
    expect(failing.length, `${failing.length} widths, from ${failing[0]} to ${failing.at(-1)}`).toBe(0);
  });
});
