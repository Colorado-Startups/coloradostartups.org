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
//   seal ends a thanks page (#261): it loads lazily, with no raised fetch
//   priority, and no heading, form, button or other picture follows it.
//
// EXEMPT is the short list of pages that may lead with art, each with its
// reason. An exempt page that is gone, or that no longer leads with art,
// fails too, so the list only shrinks.
import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { contentPages } from "./pages";

const EXEMPT: Readonly<Record<string, string>> = {
  "/ask/":
    "Resourcus's small portrait is part of its own ask box, beside its disclosure line. The site search above it has no picture.",
  "/agents/":
    "The page lists the site's AI agents: each keeper's portrait sits on its own card, beside its name and its disclosure line.",
  "/get-involved/":
    "The page has no real picture. Its first painting is a region seat card's own scene (#204), lazy, in the third section, under the steps.",
  "/get-involved/slack-community-lead/":
    "Communitas's small portrait is part of the keeper flow that shows the seat's work, beside its disclosure line.",
};

const LEAF = "img, video, canvas, svg[role='img'], [role='img']";
const PICTURE = `${LEAF}, figure`;
const ART = "[data-art], [data-portrait]";
const BRAND_DIR = "/art/brand/";
// Brand marks served from /art/brand/: not paintings, so not art here.
const MARKS = ["banner", "emblem", "icon", "favicon", "apple-touch-icon", "stone", ...REGION_IDS.map((id) => `${id}-512`)];
const MARK = new RegExp(`^(?:${MARKS.join("|")})[-.]`);
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

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

/** True when the art closes the page: lazy, no raised priority, and nothing that leads follows it. */
function closesPage(main: Element, el: Element): boolean {
  const art = el.closest(ART) ?? el;
  const imgs = [art, ...art.querySelectorAll("img")].filter((e) => e.tagName === "IMG");
  if (imgs.some((img) => img.getAttribute("loading") === "eager" || img.getAttribute("fetchpriority") === "high")) {
    return false;
  }
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

const mainOf = (html: string): Element =>
  new DOMParser().parseFromString(html, "text/html").querySelector("main") ?? document.createElement("main");

describe("first picture: the rule on known samples", () => {
  const sample = (body: string) => artLeads(mainOf(`<main>${body}</main>`));

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
});

describe("first picture over the built site", () => {
  const pages = contentPages();
  const routes = new Set(pages.map((p) => p.route));

  it("leads every page outside EXEMPT with real information, not art", { timeout: 120_000 }, () => {
    const found: string[] = [];
    for (const page of pages) {
      if (Object.hasOwn(EXEMPT, page.route)) continue;
      const leads = artLeads(mainOf(page.html));
      if (leads) found.push(`${page.route}: ${leads}`);
    }
    expect(found).toEqual([]);
  });

  it("gives every exempt page a reason, and every exempt page still exists", () => {
    for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(20);
    expect(Object.keys(EXEMPT).filter((route) => !routes.has(route))).toEqual([]);
  });

  it("drops an exemption once its page no longer leads with art", () => {
    const stale = pages
      .filter((p) => Object.hasOwn(EXEMPT, p.route) && artLeads(mainOf(p.html)) === null)
      .map((p) => `${p.route}: leads with real information now, so remove it from EXEMPT`);
    expect(stale).toEqual([]);
  });
});
