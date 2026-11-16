// No sentence runs straight into a link, on any built page (run `npm run
// build` first; test:content does).
//
// The build drops a line break between a sentence and a link that starts the
// next source line, so "share it.<a>Read the privacy policy</a>" reads
// "share it.Read the privacy policy". Seen live on /founders/ and
// /get-featured/ on 2026-11-16. The fix in the page is an explicit {" "}
// before the link.
import { describe, expect, it } from "vitest";

import { contentPages } from "./pages";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const TEXT_NODE = 3;
// Markup whose contents are not prose.
const NOT_PROSE = "script, style, template, svg, pre, code";
// Text that ends in a letter or digit and sentence punctuation, with no space after it.
const ENDS_TIGHT = /[A-Za-z0-9][.!?,;:]$/;
// A cheap first pass over the raw page, so only pages that might have a hit are parsed.
const MAYBE = /[A-Za-z0-9][.!?,;:]<a[\s>]/;

/** Each link whose text starts right after sentence punctuation, as "…before -> link text". */
function joinedLinks(doc: Document): string[] {
  const found: string[] = [];
  for (const link of doc.body.querySelectorAll("a")) {
    if (link.closest(NOT_PROSE)) continue;
    const before = link.previousSibling;
    if (before?.nodeType !== TEXT_NODE) continue;
    const text = before.textContent ?? "";
    if (ENDS_TIGHT.test(text)) found.push(`${text.slice(-30)} -> ${(link.textContent ?? "").trim().slice(0, 40)}`);
  }
  return found;
}

describe("link spacing over the built site", () => {
  it("finds a joined sentence and link in a known-bad sample, and none in known-clean ones", () => {
    const bad = '<p>We never share it.<a href="/privacy/">Read the privacy policy</a>.</p>';
    expect(MAYBE.test(bad)).toBe(true);
    expect(joinedLinks(parse(bad))).toEqual(["We never share it. -> Read the privacy policy"]);
    expect(joinedLinks(parse('<p>We never share it. <a href="/privacy/">Read the privacy policy</a>.</p>'))).toEqual([]);
    expect(joinedLinks(parse('<p><strong>Sources:</strong> <a href="#s">Source 1</a></p>'))).toEqual([]);
    expect(joinedLinks(parse('<pre>see it.<a href="#x">x</a></pre>'))).toEqual([]);
  });

  it("has no sentence that runs straight into a link", { timeout: 120_000 }, () => {
    const found: string[] = [];
    for (const page of contentPages()) {
      if (!MAYBE.test(page.html)) continue;
      for (const hit of joinedLinks(parse(page.html))) found.push(`${page.route}: ${hit}`);
    }
    expect(found).toEqual([]);
  });
});
