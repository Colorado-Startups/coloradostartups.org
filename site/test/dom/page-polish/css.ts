// CSS helpers for the page polish tests, over the built site. jsdom does no
// layout, so these tests read the rules a page ships instead of computed
// styles. css.test.ts is this file's self-test.
import { readFileSync } from "node:fs";
import path from "node:path";

import { DIST_DIR } from "../pages";

export interface CssRule {
  /** Selectors as written in the component, Astro's scoping removed. */
  selectors: string[];
  /** Declarations by property, values with whitespace collapsed. */
  decls: Record<string, string>;
  /** The at-rule the rule sits in, such as "@supports (corner-shape:bevel)", or "". */
  at: string;
}

/** Every CSS rule the page loads: inline <style> blocks plus /_astro/ stylesheets. */
export function pageCss(html: string): string {
  const page = new DOMParser().parseFromString(html, "text/html");
  const inline = [...page.querySelectorAll("style")].map((s) => s.textContent ?? "");
  const linked = [...page.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet'][href^='/']")].map((l) =>
    readFileSync(path.join(DIST_DIR, l.getAttribute("href")!), "utf8"),
  );
  return [...inline, ...linked].join("\n");
}

/** One selector in a fixed form: no scoping, one space around each combinator. */
export function normalizeSelector(selector: string): string {
  return selector
    .replace(/\[data-astro-cid-[\w-]+\]/g, "")
    .replace(/:where\(\.astro-[\w-]+\)/g, "")
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A selector list split at its top-level commas, so :is(a, b) stays whole. */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === "(") depth += 1;
    else if (list[i] === ")") depth -= 1;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/** An at-rule prelude in a fixed form: one space between words, none inside parentheses. */
function normalizeAt(prelude: string): string {
  return prelude
    .replace(/\s+/g, " ")
    .replace(/\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*:\s*/g, ":")
    .trim();
}

/**
 * Style rules in source order, each with the at-rules around it joined by a
 * space, such as "@supports (corner-shape:bevel)". Braces inside strings are
 * not handled; the site's CSS has none.
 */
export function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (text: string, at: string) => {
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === ";") start = i + 1; // a statement such as @import
      if (text[i] !== "{") continue;
      const prelude = text.slice(start, i).trim();
      let depth = 1;
      let j = i + 1;
      for (; j < text.length && depth > 0; j += 1) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") depth -= 1;
      }
      const body = text.slice(i + 1, j - 1);
      if (prelude.startsWith("@")) {
        walk(body, [at, normalizeAt(prelude)].filter(Boolean).join(" "));
      } else {
        const decls: Record<string, string> = {};
        for (const d of body.split(";")) {
          const c = d.indexOf(":");
          if (c < 0) continue;
          decls[d.slice(0, c).trim().toLowerCase()] = d.slice(c + 1).replace(/\s+/g, " ").trim();
        }
        rules.push({ selectors: splitTop(prelude).map(normalizeSelector).filter(Boolean), decls, at });
      }
      i = j - 1;
      start = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), "");
  return rules;
}

/** Every rule that names this selector, outermost first. */
export function rulesFor(css: string, selector: string): CssRule[] {
  const want = normalizeSelector(selector);
  return cssRules(css).filter((r) => r.selectors.includes(want));
}

/** The value a selector's rules give a property, the last one winning, or undefined. */
export function declFor(css: string, selector: string, prop: string, at = ""): string | undefined {
  let value: string | undefined;
  for (const r of rulesFor(css, selector)) if (r.at === at && prop in r.decls) value = r.decls[prop];
  return value;
}
