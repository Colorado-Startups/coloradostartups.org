// Every page leads with Colorado, over the built site (run `npm run build`
// first; test:content does). Paul, 2026-11-16: "the whole point of this is
// for the startup community, not to display cool art. The fantasy is the
// additional theme". So the first picture inside <main> is real information
// (a map, a chart, a person, a badge, an example card), never fantasy art.
//
// - A picture is an img, video, canvas, svg[role=img] or [role=img], or a
//   figure with none of those inside (a chart drawn in HTML, such as a
//   guide's bars). A picture in a closed <details>, a <template>, or under
//   [hidden] or aria-hidden="true" does not show on load, so it does not count.
// - Art is anything inside ArtImage's [data-art] or Portrait's
//   [data-portrait], or a file from /art/brand/ that is not a brand mark (the
//   crest banner, the emblem, the region crests, the icons, the stone tile).
// - Art may still be the first picture when it closes the page, the way the
//   seal ends a thanks page (#261). Closing art meets three rules:
//   1. It waits to load. Each img in it has loading="lazy" and no raised
//      fetch priority; an img with no loading attribute loads at once. Each
//      video or canvas in it has preload="none", as the region clip does
//      (RegionArt).
//   2. Real content comes before it, past the title block: a section that
//      does not hold the h1, or a form, list, table, button or paragraph. The
//      title block is the h1, its header, any kicker, lede or meta line, and
//      the first paragraph after the h1, which reads as a lede.
//   3. No heading, form, button or other picture follows it.
// - Every built page has a <main>, so no page passes by having none. NO_MAIN
//   lists the pages that may lack one.
//
// EXEMPT is the short list of pages that may lead with art, each with its
// reason and the widest its leading art may draw. That art may not raise its
// fetch priority or draw wider than its entry allows, so a hero added above
// it fails. An exempt page that is gone, or that no longer leads with art,
// fails too, so the list only shrinks.
import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { type BuiltPage, builtPages } from "./pages";

interface Exemption {
  reason: string;
  /** The widest the page's leading art may draw on a wide screen, in CSS px (see drawnWidth). */
  widest: number;
}

const EXEMPT: Readonly<Record<string, Exemption>> = {
  "/ask/": {
    widest: 96,
    reason:
      "Resourcus's small portrait is part of its own ask box, beside its disclosure line. The site search above it has no picture.",
  },
  "/agents/": {
    widest: 128,
    reason:
      "Each AI agent's portrait is a small identifying thumbnail, 128 px at most, beside its name, its job, its link and its disclosure line.",
  },
  "/get-involved/": {
    widest: 400,
    reason:
      "The page has no real picture. Its first painting is a region seat card's own scene (#204), lazy, in the third section, under the steps. A seat card draws it 380 px wide at most.",
  },
  "/get-involved/slack-community-lead/": {
    widest: 96,
    reason:
      "Communitas's small portrait is part of the keeper flow that shows the seat's work, beside its disclosure line.",
  },
};

// Built pages that may have no <main>, each with its reason. Only an Astro
// redirect stub, a bare meta-refresh page, belongs here. The site's redirects
// live in public/_redirects (astro.config.mjs), so the build has none.
const NO_MAIN: Readonly<Record<string, string>> = {};

const LEAF = "img, video, canvas, svg[role='img'], [role='img']";
const PICTURE = `${LEAF}, figure`;
const ART = "[data-art], [data-portrait]";
const BRAND_DIR = "/art/brand/";
// Brand marks served from /art/brand/: not paintings, so not art here.
const MARKS = ["banner", "emblem", "icon", "favicon", "apple-touch-icon", "stone", ...REGION_IDS.map((id) => `${id}-512`)];
const MARK = new RegExp(`^(?:${MARKS.join("|")})[-.]`);
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
// Rule 2: what counts as real content before closing art, besides a section that does not hold the h1.
const CONTENT = "form, ul, ol, dl, table, .btn, p";
// Rule 2: lines of the title block wherever they sit.
const TITLE_LINE = ".kicker, .lede, .meta";
const TITLE_HEADER = "header, hgroup, .info-header";
// The wide screen drawnWidth measures on, in CSS px, and one rem.
const WIDE = 1280;
const UNIT_PX: Readonly<Record<string, number>> = { px: 1, rem: 16, vw: WIDE / 100 };

/** False when the element does not show on load. */
function shown(el: Element): boolean {
  if (el.closest("template, noscript, [hidden], [aria-hidden='true']")) return false;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
    const summary = d.querySelector(":scope > summary");
    if (!d.hasAttribute("open") && !summary?.contains(el)) return false;
  }
  return true;
}

/** The first picture inside main that shows on load, or null. */
function firstPicture(main: Element): Element | null {
  for (const el of main.querySelectorAll(PICTURE)) {
    if (!shown(el)) continue;
    // A figure that holds a picture of its own is judged by that picture.
    if (el.tagName === "FIGURE" && [...el.querySelectorAll(LEAF)].some(shown)) continue;
    return el;
  }
  return null;
}

/** True for a file from /art/brand/ that is not a brand mark. */
function brandPainting(url: string): boolean {
  const at = url.indexOf(BRAND_DIR);
  if (at < 0) return false;
  const file = url.slice(at + BRAND_DIR.length).split(/[?#\s]/)[0] ?? "";
  return file.length > 0 && !MARK.test(file);
}

function urlsOf(el: Element): string[] {
  return [el, ...el.querySelectorAll("source")].flatMap((e) =>
    ["src", "srcset", "poster"].flatMap((name) => (e.getAttribute(name) ?? "").split(",").map((part) => part.trim())),
  );
}

function isArt(el: Element): boolean {
  return el.closest(ART) !== null || el.querySelector(ART) !== null || urlsOf(el).some(brandPainting);
}

/** Rule 1: an img waits with loading="lazy" and no raised priority; a video or canvas, with preload="none". */
function waits(el: Element): boolean {
  if (el.tagName === "IMG") return el.getAttribute("loading") === "lazy" && el.getAttribute("fetchpriority") !== "high";
  return el.getAttribute("preload") === "none";
}

/** Rule 2: true when real content comes before the art, past the title block. */
function contentBefore(main: Element, art: Element): boolean {
  const h1 = main.querySelector("h1");
  const header = h1?.closest(TITLE_HEADER) ?? null;
  // The first paragraph after the h1 reads as its lede, marked or not.
  const lede = h1 ? [...main.querySelectorAll("p")].find((p) => h1.compareDocumentPosition(p) & FOLLOWING) : undefined;
  const inTitle = (node: Element) => node === lede || node.matches(TITLE_LINE) || (header?.contains(node) ?? false);
  return [...main.querySelectorAll(`section, ${CONTENT}`)].some((node) => {
    const before = !node.contains(art) && (node.compareDocumentPosition(art) & FOLLOWING) !== 0;
    if (!before || !shown(node) || inTitle(node)) return false;
    if (node.tagName === "SECTION") return !(h1 && node.contains(h1));
    return node.tagName !== "P" || (node.textContent ?? "").trim().length > 0;
  });
}

/** True when the art closes the page: it meets rules 1 to 3. */
function closesPage(main: Element, el: Element): boolean {
  const art = el.closest(ART) ?? el;
  const media = [art, ...art.querySelectorAll("img, video, canvas")].filter((e) => e.matches("img, video, canvas"));
  if (!media.every(waits) || !contentBefore(main, art)) return false;
  const later = [...main.querySelectorAll(`h1, h2, h3, h4, h5, h6, form, .btn, ${PICTURE}`)];
  return later.every((node) => art.contains(node) || !(art.compareDocumentPosition(node) & FOLLOWING));
}

/** What leads the page with art, in words, or null when the page leads with something real. */
function artLeads(main: Element): string | null {
  const first = firstPicture(main);
  if (!first || !isArt(first) || closesPage(main, first)) return null;
  const marked = first.closest(ART) ?? first.querySelector(ART);
  const name = marked?.getAttribute("data-art") ?? marked?.getAttribute("data-portrait") ?? urlsOf(first).find(brandPainting);
  return `its first picture is art (${name ?? first.tagName.toLowerCase()})`;
}

/**
 * How wide a picture draws on a 1280 px screen, in CSS px. The browser picks
 * the file by `sizes`, so its last entry, the one with no media condition,
 * says it when it is a plain px, rem or vw length. Otherwise the width
 * attribute does, and a picture with neither counts as unbounded.
 */
function drawnWidth(el: Element): number {
  const last = (el.getAttribute("sizes") ?? "").split(",").at(-1)?.trim() ?? "";
  const length = /^(\d+(?:\.\d+)?)(px|rem|vw)$/.exec(last);
  if (length) return Number(length[1]) * UNIT_PX[length[2]!]!;
  const width = Number(el.getAttribute("width"));
  return width > 0 ? width : Number.POSITIVE_INFINITY;
}

/** What breaks an exemption, in words, or null: the leading art raises its priority or draws wider than allowed. */
function exemptProblem(main: Element, widest: number): string | null {
  const first = firstPicture(main);
  // A page that no longer leads with art is the staleness test's to report.
  if (!first || !isArt(first)) return null;
  const problems: string[] = [];
  if (first.getAttribute("fetchpriority") === "high") problems.push('its leading art has fetchpriority="high"');
  const drawn = drawnWidth(first);
  if (drawn > widest) problems.push(`its leading art draws ${drawn} px wide, past the ${widest} px its exemption allows`);
  return problems.length > 0 ? problems.join("; ") : null;
}

const mainOf = (html: string): Element | null => new DOMParser().parseFromString(html, "text/html").querySelector("main");

/** What is wrong with how a page leads, in words, or null. No <main> fails; an exempt page answers to its exemption. */
function leadProblem(main: Element | null, exemption?: Exemption): string | null {
  if (!main) return "it has no <main>";
  return exemption ? exemptProblem(main, exemption.widest) : artLeads(main);
}

describe("first picture: the rule on known samples", () => {
  const sample = (body: string) => artLeads(mainOf(`<main>${body}</main>`)!);

  it("flags a painting that leads, eager or lazy, and a raw brand painting", () => {
    expect(sample('<h1>T</h1><figure data-art="brand/golden"><img src="/art/brand/golden-1440.webp" loading="eager"></figure><h2>More</h2>')).toMatch(/brand\/golden/);
    expect(sample('<h1>T</h1><figure data-art="brand/denver"><img loading="lazy"></figure><h2>Next events</h2>')).toMatch(/brand\/denver/);
    expect(sample('<h1>T</h1><img src="/art/brand/founders-720.webp" alt="A scene"><form></form>')).toMatch(/founders-720/);
    expect(sample('<h1>T</h1><figure data-portrait="publicus"><img loading="lazy"></figure><a class="btn" href="/">Go</a>')).toMatch(/publicus/);
  });

  it("flags a closing seal that loads eagerly", () => {
    expect(sample('<h1>Thanks</h1><figure data-art="brand/golden"><img loading="eager"></figure>')).not.toBeNull();
    expect(sample('<h1>Thanks</h1><figure data-art="brand/golden"><img loading="lazy" fetchpriority="high"></figure>')).not.toBeNull();
  });

  it("passes a page whose first picture is real, and art after it", () => {
    expect(sample('<h1>T</h1><figure class="chart"><svg role="img"></svg></figure><figure data-art="brand/golden"><img></figure><h2>x</h2>')).toBeNull();
    expect(sample('<h1>T</h1><figure class="guide-chart"><ul><li>Bars</li></ul></figure><figure data-art="brand/guides"><img></figure><h2>x</h2>')).toBeNull();
    expect(sample('<h1>T</h1><img src="/art/brand/banner-480x600.png" alt="The crest"><figure data-art="brand/golden"><img></figure><h2>x</h2>')).toBeNull();
    expect(sample('<h1>T</h1><img src="/art/brand/photon-mountain-512-512.webp" alt="Crest"><h2>x</h2>')).toBeNull();
  });

  it("passes a lazy seal that closes the page, and skips art that is not shown on load", () => {
    expect(sample('<h1>Thanks</h1><p>Done.</p><div class="btn-row"><a class="btn" href="/">Home</a></div><figure data-art="brand/golden"><img loading="lazy"></figure><p><a href="/">Back</a></p>')).toBeNull();
    expect(sample('<h1>T</h1><details><summary>Ask</summary><figure data-portrait="resourcus"><img></figure></details><h2>x</h2>')).toBeNull();
    expect(sample('<h1>T</h1><figure data-art="brand/golden" hidden><img></figure><h2>x</h2>')).toBeNull();
    expect(sample("<h1>T</h1><p>Words only.</p><h2>x</h2>")).toBeNull();
  });

  it("flags art that closes nothing: a heading or a picture follows it", () => {
    expect(sample('<h1>T</h1><figure data-art="brand/passage"><img loading="lazy"></figure><nav><h2 class="visually-hidden">More</h2></nav>')).not.toBeNull();
    expect(sample('<h1>T</h1><figure data-art="brand/passage"><img loading="lazy"></figure><img src="/maps/statewide.svg" alt="Map">')).not.toBeNull();
  });

  // Fix 1: closing art used to need only no loading="eager" and no raised priority.
  it("flags closing art that does not wait to load: an img with no loading attribute, a video or a canvas", () => {
    const thanks = '<h1>Thanks</h1><p>Done.</p><div class="btn-row"><a class="btn" href="/">Home</a></div>';
    expect(sample(`${thanks}<figure data-art="brand/golden"><img src="/art/brand/golden-800.webp"></figure>`)).toMatch(/brand\/golden/);
    expect(sample(`${thanks}<figure data-art="brand/golden"><video muted loop></video></figure>`)).toMatch(/brand\/golden/);
    expect(sample(`${thanks}<video src="/art/brand/golden.webm" preload="metadata"></video>`)).toMatch(/golden\.webm/);
    expect(sample(`${thanks}<figure data-art="brand/forge"><canvas width="640" height="320"></canvas></figure>`)).toMatch(/brand\/forge/);
    // The same art closes the page once it waits: a lazy img, or a clip with preload="none".
    expect(sample(`${thanks}<figure data-art="brand/golden"><img src="/art/brand/golden-800.webp" loading="lazy"></figure>`)).toBeNull();
    expect(sample(`${thanks}<figure data-art="brand/golden"><video muted loop preload="none"></video></figure>`)).toBeNull();
  });

  // Fix 2: closing art used to need only nothing that leads after it.
  it("flags art that follows only the title block, with prose and plain links after it", () => {
    expect(sample('<h1>T</h1><figure data-art="brand/passage"><img loading="lazy"></figure><p>Prose only.</p><p><a href="/">A plain link</a></p>')).toMatch(/brand\/passage/);
    expect(sample('<p class="kicker">K</p><h1>T</h1><p>An unmarked lede.</p><p class="meta">Oct 6</p><figure data-art="brand/passage"><img loading="lazy"></figure><p>Prose.</p>')).toMatch(/brand\/passage/);
    expect(sample('<section><div class="info-header"><h1>T</h1><p class="lede">L</p><div class="btn-row"><a class="btn" href="/">Go</a></div></div></section><section><figure data-art="brand/denver"><img loading="lazy"></figure><p>Prose.</p></section>')).toMatch(/brand\/denver/);
  });

  it("passes closing art that follows real content: a later section, a form, or a dispatch's text", () => {
    expect(sample('<section><h1>T</h1><p class="lede">L</p></section><section><h2>Next</h2><p>Words.</p></section><section><p>Last words.</p><figure data-art="brand/denver"><img loading="lazy"></figure></section>')).toBeNull();
    expect(sample('<h1>T</h1><p class="lede">L</p><form><input name="q"></form><figure data-art="brand/golden"><img loading="lazy"></figure>')).toBeNull();
    expect(sample('<p class="kicker">Dispatches</p><h1>T</h1><p class="meta">Oct 6</p><div><p>Body one.</p><p>Body two.</p></div><figure data-art="brand/golden"><img loading="lazy"></figure><ul><li>Tag</li></ul><p><a href="/">All dispatches</a></p>')).toBeNull();
  });

  // Fix 3: an exempt page used to pass whatever art led it.
  it("holds an exempt page's leading art to its exemption: no raised priority, no wider than allowed", () => {
    const exempt = (body: string, widest: number) => exemptProblem(mainOf(`<main>${body}</main>`)!, widest);
    const thumb = '<figure data-portrait="communitas"><img src="/art/brand/communitas-small-320.webp" sizes="7rem" width="112" height="112" loading="lazy"></figure>';
    expect(exempt(`<h1>AI agents</h1><ul><li>${thumb}<h3>Communitas</h3></li></ul>`, 128)).toBeNull();
    // A hero added above the thumbnails leads now, and fails, lazy or not.
    expect(exempt(`<h1>AI agents</h1><figure data-art="brand/golden"><img sizes="100vw" width="1440" height="720" loading="lazy"></figure>${thumb}`, 128)).toMatch(/1280 px wide/);
    expect(exempt(`<h1>AI agents</h1><figure data-portrait="communitas"><img sizes="(max-width: 40rem) 90vw, 30rem" width="960" height="1200" loading="eager" fetchpriority="high"></figure>`, 128)).toMatch(/fetchpriority="high".*480 px wide/);
    // So does a thumbnail with a raised priority, or one with no sizes from a 320 px file.
    expect(exempt(`<h1>T</h1><figure data-portrait="communitas"><img sizes="7rem" width="112" loading="eager" fetchpriority="high"></figure>`, 128)).toMatch(/fetchpriority/);
    expect(exempt(`<h1>T</h1><figure data-portrait="communitas"><img width="320" height="320" loading="lazy"></figure>`, 128)).toMatch(/320 px wide/);
  });

  // Fix 4: a page with no <main> used to yield an empty one and pass.
  it("fails a page with no <main>, exempt or not", () => {
    const bare = '<!doctype html><title>T</title><h1>T</h1><figure data-art="brand/golden"><img loading="eager"></figure>';
    expect(leadProblem(mainOf(bare))).toBe("it has no <main>");
    expect(leadProblem(mainOf(bare), EXEMPT["/agents/"])).toBe("it has no <main>");
    expect(leadProblem(mainOf("<!doctype html><title>T</title><main><h1>T</h1><p>Words.</p></main>"))).toBeNull();
  });
});

describe("first picture over the built site", () => {
  const all = builtPages();
  const pages = all.filter((p) => !Object.hasOwn(NO_MAIN, p.route));
  const routes = new Set(all.map((p) => p.route));
  const exempt = (route: string): Exemption | undefined => (Object.hasOwn(EXEMPT, route) ? EXEMPT[route] : undefined);
  // Each page parsed once, for the walks below.
  const mains = new Map<string, Element | null>();
  const mainAt = (page: BuiltPage): Element | null => {
    if (!mains.has(page.route)) mains.set(page.route, mainOf(page.html));
    return mains.get(page.route) ?? null;
  };

  it("leads every page outside EXEMPT and NO_MAIN with real information, not art, inside a <main>", { timeout: 120_000 }, () => {
    const found: string[] = [];
    for (const page of pages) {
      if (exempt(page.route)) continue;
      const problem = leadProblem(mainAt(page));
      if (problem) found.push(`${page.route}: ${problem}`);
    }
    expect(found).toEqual([]);
  });

  it("keeps each exempt page's leading art at normal priority and within its width, inside a <main>", { timeout: 120_000 }, () => {
    const found: string[] = [];
    for (const page of pages) {
      const exemption = exempt(page.route);
      if (!exemption) continue;
      const problem = leadProblem(mainAt(page), exemption);
      if (problem) found.push(`${page.route}: ${problem}`);
    }
    expect(found).toEqual([]);
  });

  it("lists in NO_MAIN only built pages that have no <main>, each with a reason", () => {
    for (const [route, reason] of Object.entries(NO_MAIN)) {
      const page = all.find((p) => p.route === route);
      expect(page, `${route} is not built`).toBeDefined();
      expect(mainOf(page!.html), `${route} has a <main>`).toBeNull();
      expect(reason.length, route).toBeGreaterThan(20);
    }
  });

  it("gives every exempt page a reason and a width, and every exempt page still exists", () => {
    for (const { reason, widest } of Object.values(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(widest).toBeGreaterThan(0);
    }
    expect(Object.keys(EXEMPT).filter((route) => !routes.has(route))).toEqual([]);
  });

  it("drops an exemption once its page no longer leads with art", () => {
    // A page with no <main> is the walks' to report, never stale here.
    const stale = pages
      .filter((p) => {
        const main = mainAt(p);
        return exempt(p.route) !== undefined && main !== null && artLeads(main) === null;
      })
      .map((p) => `${p.route}: leads with real information now, so remove it from EXEMPT`);
    expect(stale).toEqual([]);
  });
});
