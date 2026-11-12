// S7 over the built site (run `npm run build` first; test:content does): the
// startup credits guide shows its notice, attributes and dates every amount,
// groups the programs, uses names and no logos, and links in from the guides
// index and Startup Resources.
import { readFileSync } from "node:fs";
import path from "node:path";

import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { amountLine, BUCKETS, CREDITS_GUIDE, parseCredits, shownPrograms, sourceLabel } from "../../../src/lib/guides/credits";
import { readDist, SITE_DIR, sitemapPaths } from "../pages";

const credits = parseCredits(readFileSync(path.resolve(SITE_DIR, "..", "data", "credits", "startup-programs.json"), "utf8"));
const doc = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const page = doc("guides/startup-credits/index.html");
const main = page.querySelector("main")!;
const rows = [...main.querySelectorAll<HTMLTableRowElement>("tr[data-program]")];
const shown = shownPrograms(credits);
const groupOf = (p: { bucket: string }) => BUCKETS.find((b) => b.key === p.bucket)?.id;

describe(CREDITS_GUIDE.path, () => {
  it("has its title, one h1 and a heading outline without skips", () => {
    expect(page.title).toBe(`${CREDITS_GUIDE.title} | Colorado Startups`);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    const levels = [...main.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1], `h${level} after h${levels[i - 1]}`).toBeLessThanOrEqual(1);
    });
  });

  it("shows the notice near the top: terms change, no affiliation, no advice", () => {
    const notice = main.querySelector("[data-credits-notice]");
    expect(notice?.closest("section")?.querySelector("h1")).not.toBeNull();
    expect(text(notice)).toMatch(/terms change/i);
    expect(text(notice)).toMatch(/not affiliated/);
    expect(text(notice)).toMatch(/legal, tax or financial advice/);
  });

  it("states the snapshot date in its answer", () => {
    expect(main.querySelector("[data-guide-answer] time")?.getAttribute("datetime")).toBe(credits.export.checked);
  });

  it("shows every program the snapshot does not omit, once, in its group, in group order", () => {
    expect(rows.map((r) => r.dataset.program).sort()).toEqual(shown.map((p) => p.id).sort());
    for (const o of credits.omit) expect(main.querySelector(`tr[data-program='${o.id}']`), o.id).toBeNull();
    const groups = [...main.querySelectorAll<HTMLElement>("section[data-credits-group]")].map((s) => s.dataset.creditsGroup);
    expect(groups).toEqual(BUCKETS.map((b) => b.id));
    for (const p of shown) {
      const row = main.querySelector(`tr[data-program='${p.id}']`);
      expect(row?.closest("section")?.getAttribute("data-credits-group"), p.id).toBe(groupOf(p));
    }
  });

  it("puts each amount, its source and its checked date in one sentence", () => {
    for (const p of shown) {
      const line = main.querySelector(`tr[data-program='${p.id}'] [data-amount-line]`);
      expect(line?.querySelector("a")?.getAttribute("href"), p.id).toBe(p.source);
      expect(line?.querySelector("time")?.getAttribute("datetime"), p.id).toBe(p.checked);
      expect(text(line), p.id).toBe(`${amountLine(p).stated}, per ${sourceLabel(p.source)}, checked ${p.checked}.`);
      const computed = main.querySelector(`tr[data-program='${p.id}'] [data-amount-computed]`);
      expect(computed ? text(computed) : null, p.id).toBe(amountLine(p).computed && `${amountLine(p).computed}.`);
    }
  });

  it("links each program by name to its official page, with no logos", () => {
    for (const p of shown) {
      const th = main.querySelector(`tr[data-program='${p.id}'] th[scope='row']`);
      expect(th?.querySelector("a")?.getAttribute("href"), p.id).toBe(p.link);
      expect(text(th?.querySelector("a")), p.id).toBe(p.program);
    }
    expect(main.querySelectorAll("table img, table svg, table picture")).toHaveLength(0);
  });

  it("carries one JSON-LD ItemList that matches the rows", () => {
    const blocks = page.querySelectorAll("script[type='application/ld+json']");
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0]!.textContent ?? "");
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(rows.length);
    expect(ld.itemListElement.map((e: { url: string }) => e.url)).toEqual(
      rows.map((r) => r.querySelector("th a")?.getAttribute("href")),
    );
  });

  it("discloses Resourcus as an AI agent where it names it", () => {
    const partners = main.querySelector("section#partners");
    expect(text(partners)).toMatch(/Resourcus, an AI agent run by Colorado Startups/);
  });

  // Astro can drop the space between a word and a link written on the next line.
  it("keeps a space between words and the links beside them", () => {
    const html = main.innerHTML;
    expect(html.match(/[A-Za-z,]<a\b[^>]*>[^<]{0,40}/g) ?? []).toEqual([]);
    expect(html.match(/<\/a>[A-Za-z][^<]{0,40}/g) ?? []).toEqual([]);
    expect(text(main)).not.toMatch(/\s[,.]/);
  });

  it("follows the house writing rules in its own words", () => {
    expect(text(main)).not.toMatch(/—|\s–\s/);
  });

  it("is in the sitemap and linked from the guides index and Startup Resources", () => {
    expect(sitemapPaths()).toContain(CREDITS_GUIDE.path);
    expect(doc("guides/index.html").querySelector(`main [data-guide-item] a[href='${CREDITS_GUIDE.path}']`)).not.toBeNull();
    const intro = doc("ecosystem-canvas/index.html").querySelector("section[aria-labelledby='canvas-title']");
    expect(intro?.querySelector(`a[href='${CREDITS_GUIDE.path}']`)).not.toBeNull();
  });

  // The 30 s limit: axe on a long page can pass 5 s when the Mac is busy.
  it("passes axe (structure and ARIA; color contrast needs a browser)", { timeout: 30_000 }, async () => {
    document.documentElement.innerHTML = page.documentElement.innerHTML;
    for (const { name, value } of page.documentElement.attributes) document.documentElement.setAttribute(name, value);
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
