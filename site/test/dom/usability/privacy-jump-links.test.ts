// Card #148 over the built site (run `npm run build` first; test:content does).
// /privacy/ lists jump links to its H2 sections right after "The short
// version". Every link lands on a heading on the page, and each one is a 44 px
// tap target on a phone.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readDist, SITE_DIR } from "../pages";

const page = new DOMParser().parseFromString(readDist("privacy/index.html"), "text/html");
const main = page.querySelector("main")!;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const nav = main.querySelector("nav[data-privacy-jump]");
const links = [...(nav?.querySelectorAll("a") ?? [])];
const headings = [...main.querySelectorAll(".prose h2")];

// jsdom has no layout, so the tap-target check reads the page's own CSS.
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(path.join(SITE_DIR, "src/pages/privacy.astro"), "utf8"))?.[1] ?? "";
function body(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
  return "";
}

describe("/privacy/ jump links (#148)", () => {
  it("lists one link per H2 section, in page order, under a visible label", () => {
    expect(nav).not.toBeNull();
    expect(text(page.getElementById(nav!.getAttribute("aria-labelledby") ?? ""))).toBe("On this page");
    expect(headings).toHaveLength(7);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(headings.map((h) => `#${h.id}`));
    expect(links.map(text)).toEqual(headings.map(text));
  });

  it("resolves every link to a heading on the page", () => {
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const href = a.getAttribute("href") ?? "";
      expect(href, href).toMatch(/^#./);
      expect(page.getElementById(decodeURIComponent(href.slice(1)))?.tagName, href).toBe("H2");
    }
  });

  it("gives every section heading its own id", () => {
    const ids = headings.map((h) => h.id);
    expect(ids.every((id) => id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Shared links such as /privacy/#your-choices depend on these. Astro makes
  // each id from its heading's words, so renaming a heading changes its id:
  // update this list on purpose when that happens.
  it("keeps the section ids that shared links point at", () => {
    expect(headings.map((h) => h.id)).toEqual([
      "the-short-version",
      "what-we-collect-and-why",
      "what-happens-automatically",
      "who-helps-us-run-the-site",
      "your-choices",
      "changes-to-this-policy",
      "contact",
    ]);
  });

  it("sits right after The short version, before the next section", () => {
    const before = nav?.previousElementSibling;
    const after = nav?.nextElementSibling;
    expect(text([...(before?.querySelectorAll("h2") ?? [])].at(-1))).toBe("The short version");
    expect(after?.firstElementChild).toBe(headings[1]);
  });

  it("makes each link a 44 px tap target", () => {
    const rule = body(STYLE, ".jump a");
    expect(rule).toMatch(/min-height:\s*(44px|var\(--size-tap\))/);
    // The token is the guarantee: it must stay at least 44 px.
    const tokens = readFileSync(path.join(SITE_DIR, "src/styles/tokens.css"), "utf8");
    expect(Number(/--size-tap:\s*(\d+)px;/.exec(tokens)?.[1])).toBeGreaterThanOrEqual(44);
    expect(rule).toMatch(/display:\s*(inline-)?flex/);
    expect(rule).toMatch(/align-items:\s*center/);
  });

  it("self-test: finds no rule for a selector the style lacks", () => {
    expect(body(STYLE, ".no-such-rule")).toBe("");
    expect(body(".a { color: red; }", ".a")).toMatch(/color:\s*red/);
  });
});
