// Step H0 over the built site (run `npm run build` first; test:content does):
// the home page's budget. Home is split into sections (components/home/
// sections/), some of them empty slots that later steps fill; these checks
// hold the page to its limits while they do. At most 60 visible words in each
// band and 450 on the page, no member count, a source line under every figure,
// and 75 KB of gzipped JavaScript or less up front (PLAN.md, Gates).
//
// The cap was 300 words for the page. Step W2 (the living map) adds the map's
// counts, and two other open steps each add up to 50 words, so one page cap
// would make each band's change fail for words another band spent. A cap per
// band keeps every band short on its own; 450 leaves room for all of them.
// A band's sourced figures (.stat: value, label and source line) are left out
// of its cap, though not the page's: Why Colorado holds nine of them by design,
// each kept honest by the source-line check below, and they are data, not copy.
//
// Words behind a closed door (a <details> body, everything but its <summary>)
// are not on screen until the visitor opens it, so they count toward neither
// a band's 60 nor the page's 450. Each door's body has its own cap instead: at
// most 30 words. The cap per band is unchanged (orchestrator, 2026-11-16).
// A band holds at most 8 doors, one for each kind of visitor, so doors cannot
// become a way to keep a long text out of the count: the most a band can hold
// behind its doors is 8 times 30, 240 words.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { DIST_DIR, readDist } from "../pages";

const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// Words a reader sees in <main>. Not counted: scripts, styles, hidden and
// visually hidden text, and the maps' SVG labels (city and road names on a
// drawing, not copy).
//
// The build strips the whitespace between elements, so the text of two
// elements can touch ("doorIdea"). The count walks the text nodes and joins
// them with a space, so words from different elements never merge.
const UNSEEN = "script, style, template, noscript, svg, [hidden], [aria-hidden='true'], .visually-hidden";
const CLOSED_DOOR = "details:not([open]) > :not(summary)";
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
function wordsOf(root: Element, unseen: string): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE) parts.push(child.textContent ?? "");
      else if (child.nodeType === child.ELEMENT_NODE && !(child as Element).matches(unseen)) walk(child);
    }
  };
  walk(root);
  return parts.join(" ").match(WORD) ?? [];
}
/** Words on screen in `root`; closed doors' bodies are left out. */
const visibleWords = (root: Element, skip = "") => wordsOf(root, [UNSEEN, CLOSED_DOOR, skip].filter(Boolean).join(", "));
/** Words in a door's body: every child of the <details> but its <summary>. */
const doorBodyWords = (door: Element) =>
  [...door.children].filter((c) => !c.matches(`summary, ${UNSEEN}`)).flatMap((c) => wordsOf(c, UNSEEN));

describe("the word counter", () => {
  it("counts the words of adjacent elements separately, even with no whitespace between them", () => {
    const fixture = new DOMParser().parseFromString(
      '<main><h2>Pick your door</h2><ul><li><span>Idea</span><b>Slack,</b><a href="/">Monday</a></li></ul><p hidden>Gone</p></main>',
      "text/html",
    );
    expect(visibleWords(fixture.querySelector("main")!)).toEqual(["Pick", "your", "door", "Idea", "Slack,", "Monday"]);
  });

  it("leaves a closed door's body out of the visible words, and counts it as the door's body", () => {
    const fixture = new DOMParser().parseFromString(
      "<main><details><summary>Idea</summary><ul><li>Join<b>the</b>Slack</li></ul></details><details open><summary>Hiring</summary><p>Open text</p></details></main>",
      "text/html",
    );
    const main = fixture.querySelector("main")!;
    expect(visibleWords(main)).toEqual(["Idea", "Hiring", "Open", "text"]);
    expect([...main.querySelectorAll("details")].map(doorBodyWords)).toEqual([["Join", "the", "Slack"], ["Open", "text"]]);
  });
});

describe("home budget", () => {
  const main = home.querySelector("main")!;

  it("has at most 450 visible words", () => {
    const words = visibleWords(main);
    console.info(`index.html: ${words.length} visible words in <main>`);
    expect(words.length).toBeGreaterThan(0);
    expect(words.length).toBeLessThanOrEqual(450);
  });

  it("has at most 60 visible words in each band, its sourced figures aside", () => {
    const bands = [...main.children].filter((el) => el.matches("section"));
    expect(bands.length).toBeGreaterThan(1);
    for (const band of bands) {
      const words = visibleWords(band, ".stat").length;
      const name = band.getAttribute("aria-labelledby") ?? band.getAttribute("aria-label") ?? band.className;
      console.info(`index.html: ${words} visible words in the ${name} band`);
      expect(words, name).toBeLessThanOrEqual(60);
    }
  });

  it("has at most 30 words behind each door", () => {
    const doors = [...main.querySelectorAll("details")];
    expect(doors.length, "the Pick your door doors").toBeGreaterThan(0);
    for (const door of doors) {
      const label = text(door.querySelector("summary"));
      const words = doorBodyWords(door).length;
      console.info(`index.html: ${words} words behind the ${label} door`);
      expect(words, label).toBeGreaterThan(0);
      expect(words, label).toBeLessThanOrEqual(30);
    }
  });

  it("has at most 8 doors in each band", () => {
    for (const band of [...main.children].filter((el) => el.matches("section"))) {
      const name = band.getAttribute("aria-labelledby") ?? band.getAttribute("aria-label") ?? band.className;
      expect(band.querySelectorAll("details").length, name).toBeLessThanOrEqual(8);
    }
  });

  it("states no member count", () => {
    const body = text(home.body);
    expect(body).not.toMatch(/\b\d[\d,.]*\s*[kK+]?\+?\s+(?:members|founders|people|builders|startups in (?:the|our) (?:Slack|community))\b/);
    expect(body).not.toMatch(/\bmember count\b/i);
  });

  it("gives every figure a source line", () => {
    const stats = [...main.querySelectorAll(".stat")];
    expect(stats.length, "the Why Colorado figures").toBeGreaterThan(0);
    for (const s of stats) expect(text(s.querySelector(".stat__source")).length, text(s)).toBeGreaterThan(0);
  });

  it("keeps the bands in the order they had before the split into sections", () => {
    const outline = [...main.querySelectorAll("h1, h2")].map((h) => `${h.tagName} ${text(h)}`);
    expect(outline).toEqual(["H1 Colorado Startups", "H2 This week", "H2 Three regions along the Front Range", "H2 Why Colorado", "H2 Pick your door", "H2 Explore", "H2 Ask"]);
    expect(main.lastElementChild?.matches("section.keepers"), "the keepers last").toBe(true);
  });
});

// The up-front JavaScript walk, copied from site/test/dom/l8/regions.test.ts
// (importing a test file would run its tests here too): a page's entry
// scripts and every file they import statically. What it may load later by
// import() is measured and logged, not budgeted.
const local = (from: string, spec: string) =>
  spec.startsWith("/") ? path.join(DIST_DIR, spec.replace(/^\//, "")) : path.resolve(path.dirname(from), spec);
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']((?:\.{1,2}\/|\/)[^"']+\.m?js)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*[`"']((?:\.{1,2}\/|\/)[^`"']+\.m?js)[`"']\s*\)/g;

function jsOf(page: Document): { upFront: Set<string>; lazy: Set<string> } {
  const upFront = new Set<string>();
  const lazy = new Set<string>();
  const queue: string[] = [];
  for (const s of page.querySelectorAll("script")) {
    const src = s.getAttribute("src");
    if (src?.startsWith("/")) queue.push(path.join(DIST_DIR, src.replace(/^\//, "")));
    else if (!src) for (const m of (s.textContent ?? "").matchAll(STATIC_IMPORT)) queue.push(local(path.join(DIST_DIR, "x.js"), m[1]!));
  }
  while (queue.length) {
    const file = queue.pop()!;
    if (upFront.has(file) || !existsSync(file)) continue;
    upFront.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(STATIC_IMPORT)) queue.push(local(file, m[1]!));
    for (const m of source.matchAll(DYNAMIC_IMPORT)) lazy.add(local(file, m[1]!));
  }
  for (const f of upFront) lazy.delete(f);
  return { upFront, lazy };
}
const gz = (files: Iterable<string>) => [...files].filter(existsSync).reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);

describe("home JS budget", () => {
  it("ships 75 KB of gzipped JavaScript or less up front, with no MapLibre", () => {
    const { upFront, lazy } = jsOf(home);
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    console.info(`index.html: up front ${kb(gz(upFront))} gzipped, on demand ${kb(gz(lazy))} gzipped`);
    expect(gz(upFront)).toBeLessThanOrEqual(75 * 1024);
    expect([...upFront].some((f) => /maplibre/i.test(path.basename(f))), "MapLibre in the up-front JavaScript").toBe(false);
  });
});
