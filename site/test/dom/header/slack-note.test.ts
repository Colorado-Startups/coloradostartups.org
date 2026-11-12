// #128: every "Join the Slack" button says it opens a Google Form. The header's
// button is described by a note on every page; the hero buttons on home,
// Community and Founders carry a visible note under them. Reads the built
// site, so run `npm run build` first (test:content does).
import { describe, expect, it } from "vitest";

import { contentPages } from "../pages";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** The note that describes a link, or "" when its aria-describedby names nothing. */
function noteFor(doc: Document, link: Element | null): string {
  const id = link?.getAttribute("aria-describedby");
  return id ? (doc.getElementById(id)?.textContent?.trim() ?? "") : "";
}

describe("Join the Slack says it opens a Google Form", () => {
  it("self-test: a button with no note is caught, and one with a note passes", () => {
    const bad = parse('<a href="/slack/">Join the Slack</a>');
    const good = parse('<a href="/slack/" aria-describedby="n">Join the Slack</a><span id="n">Opens a Google Form.</span>');
    expect(noteFor(bad, bad.querySelector("a"))).toBe("");
    expect(noteFor(good, good.querySelector("a"))).toMatch(/Google Form/);
  });

  it.each(contentPages().map((p) => [p.route, p] as const))("%s: the header button is described", (_route, page) => {
    const doc = parse(page.html);
    const cta = doc.querySelector("header #site-nav .cta");
    if (!cta) return;
    expect(noteFor(doc, cta)).toBe("Opens a Google Form.");
  });

  // Every Join the Slack button in main, not only the first: /founders/ has
  // one in its first screen (#483) and one lower down, and only the lower one
  // had a note (review of #518). The card links home and /community/ build
  // from channels.ts are plain links with no note yet; #128 tracks them.
  it.each(["/", "/community/", "/founders/"])("%s: every Join the Slack button has a visible note", (route) => {
    const page = contentPages().find((p) => p.route === route)!;
    const doc = parse(page.html);
    const joins = [...doc.querySelectorAll("main a.btn")].filter((a) => a.textContent?.trim() === "Join the Slack");
    expect(joins.length).toBeGreaterThan(0);
    for (const join of joins) expect(noteFor(doc, join)).toBe("Join the Slack opens a Google Form.");
  });
});
