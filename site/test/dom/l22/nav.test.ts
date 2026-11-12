// L22: the header nav ships collapsed in the HTML, so a phone's first paint is
// the final layout. When the deferred module script collapsed it instead, long
// pages (the Canvas, the Leaderboard) painted the nav open and then shifted
// (CLS 0.186 on mobile). Over the built site (run `npm run build` first;
// test:content does), plus a self-test with the old markup as the known-bad.
import { describe, expect, it } from "vitest";

import { contentPages } from "../pages";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** What stops this page's header from painting collapsed, or [] when nothing does. */
export function navProblems(doc: Document): string[] {
  const problems: string[] = [];
  const nav = doc.querySelector("header #site-nav");
  const toggle = doc.querySelector("header .menu-toggle");
  if (!nav || !toggle) return ["no #site-nav or .menu-toggle in the header"];
  if (nav.getAttribute("data-collapsible") !== "true") problems.push('#site-nav lacks data-collapsible="true"');
  if (toggle.hasAttribute("hidden")) problems.push(".menu-toggle ships hidden");
  const fallback = Array.from(doc.querySelectorAll("header noscript"))
    .map((n) => n.textContent ?? "")
    .join(" ");
  if (!/\.menu-toggle[^{]*\{[^}]*display:\s*none/.test(fallback)) problems.push("no <noscript> rule hides the toggle");
  if (!/#site-nav[^{]*\{[^}]*display:\s*flex/.test(fallback)) problems.push("no <noscript> rule shows the nav");
  return problems;
}

const OLD = `<header class="site-header"><button class="menu-toggle" hidden>Menu</button>
  <nav id="site-nav"><ul><li><a href="/team/">Team</a></li></ul></nav></header>`;
const NEW = `<header class="site-header"><button class="menu-toggle">Menu</button>
  <nav id="site-nav" data-collapsible="true"><ul><li><a href="/team/">Team</a></li></ul></nav>
  <noscript><style>.site-header .menu-toggle { display: none !important; }
  .site-header #site-nav { display: flex !important; }</style></noscript></header>`;

describe("header nav ships collapsed", () => {
  it("self-test: the old markup (collapsed by script) is caught", () => {
    expect(navProblems(parse(OLD))).toEqual([
      '#site-nav lacks data-collapsible="true"',
      ".menu-toggle ships hidden",
      "no <noscript> rule hides the toggle",
      "no <noscript> rule shows the nav",
    ]);
  });

  it("self-test: the collapsed markup with its no-JS fallback passes", () => {
    expect(navProblems(parse(NEW))).toEqual([]);
  });

  it.each(contentPages().map((p) => [p.route, p] as const))("%s ships the nav collapsed", (_route, page) => {
    expect(navProblems(parse(page.html))).toEqual([]);
  });
});
