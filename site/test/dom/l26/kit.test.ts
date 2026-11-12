// L26 over the built site (run `npm run build` first; test:content does):
// /leaderboard/kit/ shows both badges, each with a snippet whose link and
// image are absolute production URLs and whose alt text is plain words, the
// files it offers exist, the page names no rank, and it passes axe.
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BADGE_SIZE, badgeFile, badgeSnippet, KIT_BADGES, SITE_ORIGIN } from "../../../src/components/kit/badges";
import { axeViolations } from "../l9/axe";
import { contentPages, DIST_DIR, readDist, sitemapPaths } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const RANK_WORDS = /\b(top|best|fastest|leading|winners?|#\s?\d+|no\.\s?\d+|number one)\b/i;
const LINK_TARGETS: Record<string, string> = {
  "leaderboard-2026-honoree": "https://coloradostartups.org/leaderboard/",
  "startup-resources-listed": "https://coloradostartups.org/ecosystem-canvas/",
};

describe("/leaderboard/kit/", () => {
  const source = readDist("leaderboard/kit/index.html");
  const page = doc(source);
  const main = page.querySelector("main")!;
  const cards = [...main.querySelectorAll<HTMLElement>("[data-kit-badge]")];

  it("has a unique title and meta description", () => {
    const title = text(page.querySelector("title"));
    const description = page.querySelector("meta[name='description']")?.getAttribute("content") ?? "";
    expect(title).toBe("Badge kit | Colorado Startups");
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(160);
    const others = contentPages().filter((p) => p.route !== "/leaderboard/kit/").map((p) => doc(p.html));
    expect(others.map((o) => text(o.querySelector("title")))).not.toContain(title);
    expect(others.map((o) => o.querySelector("meta[name='description']")?.getAttribute("content"))).not.toContain(description);
  });

  it("shows both badges, in order, each under its own heading with its preview", () => {
    expect(cards.map((c) => c.dataset.kitBadge)).toEqual(KIT_BADGES.map((b) => b.id));
    for (const [i, badge] of KIT_BADGES.entries()) {
      const card = cards[i]!;
      expect(text(card.querySelector("h2"))).toBe(badge.name);
      const img = card.querySelector<HTMLImageElement>(".kit-preview img")!;
      expect(img.getAttribute("src")).toBe(badgeFile(badge, "svg"));
      expect(img.getAttribute("alt")).toBe(badge.alt);
    }
  });

  it.each(KIT_BADGES.map((b) => [b.id, b] as const))("%s offers a snippet with absolute production URLs and plain alt text", (id, badge) => {
    const card = main.querySelector(`[data-kit-badge='${id}']`)!;
    const field = card.querySelector<HTMLTextAreaElement>("textarea[data-snippet]")!;
    expect(field.hasAttribute("readonly")).toBe(true);
    expect(text(page.querySelector(`label[for='${field.id}']`))).toBe("HTML to copy");
    // The text a visitor copies is the snippet, byte for byte.
    expect(field.value).toBe(badgeSnippet(badge));

    const snippet = doc(field.value).body;
    const links = snippet.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const href = links[0]!.getAttribute("href")!;
    expect(href).toBe(LINK_TARGETS[id]);
    expect(new URL(href).origin).toBe(SITE_ORIGIN);

    const img = links[0]!.querySelector("img")!;
    const src = img.getAttribute("src")!;
    expect(src).toBe(`${SITE_ORIGIN}${badgeFile(badge, "svg")}`);
    expect(new URL(src).protocol).toBe("https:");
    expect(img.getAttribute("alt")).toBe(badge.alt);
    expect(img.getAttribute("alt")).not.toMatch(/[<>]/);
    expect(img.getAttribute("width")).toBe(String(BADGE_SIZE.width));
    expect(img.getAttribute("height")).toBe(String(BADGE_SIZE.height));
  });

  it("hides each copy button until the script runs, with a status line beside it", () => {
    const buttons = [...main.querySelectorAll<HTMLButtonElement>("button[data-copy]")];
    expect(buttons).toHaveLength(KIT_BADGES.length);
    for (const button of buttons) {
      expect(button.hidden).toBe(true);
      expect(button.type).toBe("button");
      expect(text(button)).toBe("Copy the HTML");
      expect(main.querySelector(`textarea#${button.dataset.copy}`)).not.toBeNull();
      expect(main.querySelector(`[role='status'][data-copy-status='${button.dataset.copy}']`)).not.toBeNull();
    }
    expect(page.querySelector("script[type='module'][src^='/_astro/']")).not.toBeNull();
  });

  it("offers the SVG and both PNGs of each badge, and every file is in the build", () => {
    for (const badge of KIT_BADGES) {
      const card = main.querySelector(`[data-kit-badge='${badge.id}']`)!;
      const hrefs = [...card.querySelectorAll<HTMLAnchorElement>(".kit-files a[download]")].map((a) => a.getAttribute("href"));
      const want = (["svg", "png", "png2x"] as const).map((f) => badgeFile(badge, f));
      expect(hrefs).toEqual(want);
      for (const file of want) expect(existsSync(path.join(DIST_DIR, file)), file).toBe(true);
    }
  });

  it("links each badge's audience to a page and an anchor that exist", () => {
    const leaderboard = doc(readDist("leaderboard/index.html"));
    expect(main.querySelector("a[href='/leaderboard/#2026-honorees']")).not.toBeNull();
    expect(leaderboard.getElementById("2026-honorees")).not.toBeNull();
    expect(main.querySelector("a[href='/ecosystem-canvas/']")).not.toBeNull();
    expect(existsSync(path.join(DIST_DIR, "ecosystem-canvas", "index.html"))).toBe(true);
  });

  it("states the terms in plain words: who, keep the link, don't alter, unranked, not a recommendation", () => {
    const terms = text(main.querySelector("#terms")?.closest("section"));
    expect(terms).toContain("Use the Leaderboard badge if your company is listed in the 2026 Honorees.");
    expect(terms).toContain("Use the Startup Resources badge if your organization is listed in Startup Resources.");
    expect(terms).toContain("Keep the link.");
    expect(terms).toContain("Don't change its words, colors or shape.");
    expect(terms).toContain("The 2026 edition is unranked");
    expect(terms).toContain("It does not mean Colorado Startups recommends your company or partners with it.");
    expect(terms).toContain("info@coloradostartups.org");
  });

  it("names no rank anywhere in the page or its head", () => {
    expect(text(main)).not.toMatch(RANK_WORDS);
    const head = [text(page.querySelector("title")), page.querySelector("meta[name='description']")?.getAttribute("content") ?? ""];
    for (const t of head) expect(t).not.toMatch(RANK_WORDS);
  });

  it("orders headings without skipping a level, keeps ids unique, and is in the sitemap", () => {
    const levels = [...main.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    const ids = [...page.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.filter((v, i) => ids.indexOf(v) !== i)).toEqual([]);
    expect(sitemapPaths()).toContain("/leaderboard/kit/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

// The committed SVGs are generated. This catches a hand edit, or a change to
// badges.ts or the tokens without a rerun. The fonts come from the build;
// without them, or when Google served other font files than the ones in
// badge-fonts.json (#268), the check cannot run, which is not the same as
// stale. test/unit/l26/badge-check.test.ts covers both outcomes. In CI a skip
// also prints a ::warning:: naming the reason, as exit 3 does through
// 04_tools/ci_gate.sh, so a lasting font change is seen (#380).
describe("the committed badge SVGs", () => {
  it("match what build-badges.mjs renders from badges.ts and the tokens", async (ctx) => {
    const gen = await import("../../../src/components/kit/build-badges.mjs");
    const skip = (reason: string) => {
      const warning = gen.couldNotCheckWarning(reason);
      if (warning) console.log(warning);
      return ctx.skip(`could not check: ${reason}`);
    };
    let fonts: Awaited<ReturnType<typeof gen.loadFonts>>;
    try {
      fonts = await gen.loadFonts();
    } catch (e) {
      return skip((e as Error).message);
    }
    const { couldNotCheck, stale } = gen.checkBadges({ fonts, tokens: gen.loadTokens(), record: gen.loadFontRecord() });
    if (couldNotCheck) skip(couldNotCheck);
    for (const s of stale) {
      expect(s.committed, `${s.id}.svg is stale; run node site/src/components/kit/build-badges.mjs`).toBe(s.rendered);
    }
  });
});
