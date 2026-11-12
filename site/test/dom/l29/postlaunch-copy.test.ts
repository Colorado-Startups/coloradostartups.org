// L29 over the built site (run `npm run build` first; test:content does). The
// site went live on 2026-10-18, but the founders forum has not opened. No
// forum line may still say it opens "after launch", and the guide table of
// contents names the unit of each count.
import { describe, expect, it } from "vitest";

import { GUIDE_SLUGS } from "../../../src/lib/guides/guides";
import { builtPages, readDist } from "../pages";

const doc = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x !== "");

// A page's words from its raw HTML: meta content values, then the text with
// every tag turned into a space, so a badge and the line after it stay apart.
// Scripts and styles are left out. Raw HTML, not a parsed DOM, keeps the
// site-wide check fast on a busy Mac.
function pageText(html: string): string {
  const meta = [...html.matchAll(/<meta\b[^>]*\bcontent="([^"]*)"/gi)].map((m) => m[1]);
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return [...meta, body].join(" ").replace(/\s+/g, " ").trim();
}

// The wording that went stale at launch. A sentence counts when it names the
// forum, or follows one that does ("A private forum. It opens after launch."),
// so other copy may still talk about a launch.
const STALE = /\bafter (?:the new site )?launch|\bsite launches\b/i;
const FORUM = /forum/i;
const staleForumLines = (s: string) => {
  const all = sentences(s);
  return all.filter((x, i) => STALE.test(x) && (FORUM.test(x) || FORUM.test(all[i - 1] ?? "")));
};

describe("stale forum wording check: self-test", () => {
  it("catches each old phrase in a forum sentence", () => {
    for (const bad of [
      "A private forum for founders only. It opens after the new site launches.",
      "Coming after launch: a private forum for founders only.",
      "A private forum for founders. It opens after launch.",
      "A private forum for Colorado founders opens after the new site launches.",
      "Founders forum After launch A private forum for founders only.",
    ]) {
      expect(staleForumLines(bad), bad).toHaveLength(1);
    }
  });

  it("catches the old card and meta description in raw HTML", () => {
    const card = '<h3>Founders forum</h3><span class="hall-badge">After launch</span><p>A private forum.</p>';
    expect(staleForumLines(pageText(card))).toHaveLength(1);
    const meta = '<meta name="description" content="A private forum. It opens after the new site launches.">';
    expect(staleForumLines(pageText(meta))).toHaveLength(1);
    expect(staleForumLines(pageText("<style>.forum-note{}</style><p>Launch after launch week.</p>"))).toEqual([]);
  });

  it("passes the new wording and launch talk that is not about the forum", () => {
    for (const clean of [
      "A private forum for founders only. It opens later.",
      "Coming later: a private forum for founders only.",
      "The Launch stage lists accelerators, service providers and early investors.",
      "We relaunched the site after launch week.",
    ]) {
      expect(staleForumLines(clean), clean).toEqual([]);
    }
  });
});

describe("the founders forum after launch", () => {
  // The 30 s limit: reading every built page can pass 5 s when the Mac is busy.
  it("no built page and no llms.txt says the forum opens after launch", { timeout: 30_000 }, () => {
    const files = [
      ...builtPages().map((p) => ({ route: p.route, text: pageText(p.html) })),
      { route: "/llms.txt", text: readDist("llms.txt") },
    ];
    expect(files.length).toBeGreaterThan(1);
    expect(files.flatMap((f) => staleForumLines(f.text).map((s) => `${f.route}: ${s}`))).toEqual([]);
  });

  it("says Coming later on the /founders/ kicker and the /community/ card badge", () => {
    expect(text(doc("founders/index.html").querySelector("main .kicker"))).toBe("Coming later");
    const card = doc("community/index.html").querySelector("[data-channel='founders-forum']");
    expect(text(card?.querySelector(".hall-badge"))).toBe("Coming later");
    expect(text(card)).toMatch(/opens later/);
  });

  it("says opens later on the home page, /links/, the welcome desk and llms.txt", () => {
    const home = doc("index.html");
    expect(text(home.querySelector(".forum-note"))).toMatch(/^Coming later: a private forum for founders only\./);
    expect(text(doc("links/index.html").querySelector("main"))).toMatch(/A private forum for founders\. It opens later\./);
    expect(text(home.querySelector("main"))).toMatch(/A private forum for Colorado founders opens later\./);
    expect(readDist("llms.txt")).toMatch(/^- \[Founders forum\]\([^)]+\): .*It opens later\.$/m);
  });
});

describe.each(GUIDE_SLUGS)("/guides/%s/ table of contents", (slug) => {
  const main = doc(`guides/${slug}/index.html`).querySelector("main")!;
  const entries = [...main.querySelectorAll("nav[aria-label='On this page'] li")];

  it("gives each section's count with its unit, singular for one", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const li of entries) {
      const id = li.querySelector("a")?.getAttribute("href")?.slice(1) ?? "";
      const n = main.querySelectorAll(`section#${id} [data-guide-item]`).length;
      expect(n, id).toBeGreaterThan(0);
      expect(text(li.querySelector(".meta")), id).toBe(n === 1 ? "(1 listing)" : `(${n} listings)`);
    }
  });
});
