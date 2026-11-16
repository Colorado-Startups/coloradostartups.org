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

// Markup whose contents are not prose.
const NOT_PROSE = /<(script|style|template|svg|pre|code)\b[\s\S]*?<\/\1>/gi;
// A letter or digit, then sentence punctuation, then a link's opening tag with nothing between.
const JOINED = /[A-Za-z0-9][.!?,;:]<a[\s>][^>]*>[^<]{0,40}/g;

describe("link spacing over the built site", () => {
  it("finds a joined sentence and link in a known-bad sample, and none in a known-clean one", () => {
    expect("share it.<a href=\"/privacy/\">Read".match(JOINED)).not.toBeNull();
    expect("share it. <a href=\"/privacy/\">Read".match(JOINED)).toBeNull();
    expect("<strong>Sources:</strong> <a href=\"#s\">Source 1</a>".match(JOINED)).toBeNull();
  });

  it("has no sentence that runs straight into a link", () => {
    const found: string[] = [];
    for (const page of contentPages()) {
      const prose = page.html.replace(NOT_PROSE, "");
      for (const hit of prose.match(JOINED) ?? []) found.push(`${page.route}: ${hit.replace(/<a[^>]*>/, " -> ")}`);
    }
    expect(found).toEqual([]);
  });
});
