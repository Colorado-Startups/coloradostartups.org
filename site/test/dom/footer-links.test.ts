import { readFileSync } from "node:fs";
import path from "node:path";

import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { GUIDES_INDEX } from "../../src/lib/guides/guides";
import { contentPages, readDist, SITE_DIR } from "./pages";

// The footer's links (cards #149 and #150). Every built page's footer links
// Startup Resources and the guides, and /links/ lists the guides beside
// Startup Resources. Run `npm run build` first (test:content does).
//
// jsdom lays nothing out, so the 44 px phone tap targets are checked in the
// footer's own style: at 720 px and below, each link is a block at least 44 px
// tall and the list drops its gap. A browser measured the result at 375 px
// (the PR for #149 lists it).

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** The body of the first `@media <query> { ... }` block in `css`, or null. */
export function mediaBlock(css: string, query: string): string | null {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

/** What keeps the footer's phone links under 44 px tall; empty when nothing does. */
export function phoneTapProblems(css: string): string[] {
  const phone = mediaBlock(css, "(max-width: 720px)");
  if (phone === null) return ["no @media (max-width: 720px) block"];
  const rule = (selector: string) => phone.match(new RegExp(`(?:^|[\\s}])${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const problems: string[] = [];
  if (!/display:\s*block/.test(rule("ul a"))) problems.push("ul a is not display: block");
  if (!/min-height:\s*(44px|var\(--size-tap\))/.test(rule("ul a"))) problems.push("ul a has no min-height: 44px");
  if (!/padding-block:/.test(rule("ul a"))) problems.push("ul a has no block padding");
  if (!/gap:\s*0/.test(rule("ul"))) problems.push("ul keeps its gap");
  return problems;
}

describe("phoneTapProblems", () => {
  it("passes 44 px block links in a gapless list (known clean)", () => {
    const css = `@media (max-width: 720px) { .grid { grid-template-columns: 1fr; }
      ul { gap: 0; } ul a { display: block; min-height: 44px; padding-block: var(--s-2); } }`;
    expect(phoneTapProblems(css)).toEqual([]);
  });

  it("flags inline links and a missing phone block (known bad)", () => {
    expect(phoneTapProblems("ul { gap: var(--s-2); }")).toEqual(["no @media (max-width: 720px) block"]);
    expect(phoneTapProblems("@media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }")).toEqual([
      "ul a is not display: block",
      "ul a has no min-height: 44px",
      "ul a has no block padding",
      "ul keeps its gap",
    ]);
  });
});

describe("SiteFooter.astro on phones", () => {
  it("gives every footer link a 44 px tap target", () => {
    const source = readFileSync(path.join(SITE_DIR, "src/components/ui/SiteFooter.astro"), "utf8");
    const style = source.slice(source.indexOf("<style>"));
    expect(phoneTapProblems(style)).toEqual([]);
  });
});

describe("the footer's Resources links on every built page", () => {
  it.each(contentPages().map((p) => [p.route, p] as const))("%s links Startup Resources and Guides", (_route, page) => {
    const nav = parse(page.html).querySelector('.site-footer nav[aria-label="Resources"]');
    const links = [...(nav?.querySelectorAll("a") ?? [])].map((a) => [text(a), a.getAttribute("href")]);
    expect(links).toEqual([
      ["Startup Resources", WAYS_IN.canvas],
      ["Guides", GUIDES_INDEX.path],
    ]);
  });
});

describe("/links/", () => {
  it("lists Guides right after Startup Resources in Find what you need", () => {
    const group = parse(readDist("links/index.html")).querySelector('[data-group="find"]');
    const rows = [...(group?.querySelectorAll("a.row") ?? [])].map((a) => [
      text(a.querySelector(".label")),
      a.getAttribute("href"),
    ]);
    expect(rows.slice(0, 2)).toEqual([
      ["Startup Resources", WAYS_IN.canvas],
      ["Guides", GUIDES_INDEX.path],
    ]);
  });
});
