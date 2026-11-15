// L23 over the built site (run `npm run build` first; test:content does): the
// /guides/ pages answer first, list real records from Startup Resources, link
// only to absolute or on-site URLs, and carry exactly one JSON-LD block.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { GUIDE_SLUGS, GUIDES, GUIDES_INDEX } from "../../../src/lib/guides/guides";
import { REGIONS } from "../../../src/lib/regions/match";
import { contentPages, readDist, SITE_DIR, sitemapPaths } from "../pages";

const DATA = path.resolve(SITE_DIR, "..", "data", "resources");
const active = new Map<string, { url: string }>(
  readdirSync(DATA, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => parse(readFileSync(path.join(DATA, d.name, f), "utf8"))))
    .filter((r) => r.status === "active")
    .map((r) => [r.id, r]),
);

const doc = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x !== "");
const canvasAnchors = new Set([...doc("ecosystem-canvas/index.html").querySelectorAll("[id^='r-']")].map((e) => e.id));

const PAGES = [
  { route: GUIDES_INDEX.path, file: "guides/index.html", title: GUIDES_INDEX.title },
  ...GUIDE_SLUGS.map((slug) => ({ route: `/guides/${slug}/`, file: `guides/${slug}/index.html`, title: GUIDES[slug].title })),
];

// On-site: a path from the root ("/x", never "//host") or a fragment. Absolute:
// http or https with a host. Anything else (a relative path, mailto:, javascript:)
// fails.
const linkShape = (href: string) =>
  /^\/(?!\/)/.test(href) || href.startsWith("#") ? "on-site" : /^https?:\/\/[^/]/.test(href) ? "absolute" : "bad";

describe("linkShape self-test", () => {
  it("passes on-site and absolute links and fails every other shape", () => {
    for (const good of ["/", "/guides/", "#learn", "https://example.org/", "http://example.org/x"]) {
      expect(linkShape(good), good).not.toBe("bad");
    }
    for (const bad of ["guides/", "../x", "//example.org/", "mailto:a@b.c", "javascript:void(0)", "https://", ""]) {
      expect(linkShape(bad), bad).toBe("bad");
    }
  });
});

describe.each(PAGES)("$route", ({ route, file, title }) => {
  const page = doc(file);
  const main = page.querySelector("main")!;

  it("opens with a direct answer of two or three sentences that states its source and date", () => {
    const answer = main.querySelector("[data-guide-answer]");
    expect(answer).not.toBeNull();
    expect(answer?.closest("section")?.querySelector("h1")).not.toBeNull();
    const n = sentences(text(answer)).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    const time = answer?.querySelector("time");
    expect(time?.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The count, its source and the date share one sentence.
    const counted = sentences(text(answer)).find((s) => s.includes(`as of ${time?.textContent}`));
    expect(counted).toMatch(/\d+ .*Startup Resources|Startup Resources .*\d+/);
  });

  it("gives a real list with at least one item", () => {
    const lists = [...main.querySelectorAll("ul[data-guide-list]")];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) expect(list.querySelectorAll(":scope > li").length).toBeGreaterThan(0);
  });

  it("links only to absolute URLs or on-site paths", () => {
    const hrefs = [...page.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => linkShape(h) === "bad")).toEqual([]);
  });

  it("carries exactly one JSON-LD block, an ItemList that parses", () => {
    const blocks = page.querySelectorAll("script[type='application/ld+json']");
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0]!.textContent ?? "");
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.url).toBe(`https://coloradostartups.org${route}`);
    expect(ld.numberOfItems).toBe(ld.itemListElement.length);
    expect(ld.numberOfItems).toBe(main.querySelectorAll("[data-guide-item]").length);
  });

  it("has its own title and meta description", () => {
    expect(page.title).toBe(`${title} | Colorado Startups`);
    const others = contentPages().filter((p) => p.route !== route);
    const desc = page.querySelector('meta[name="description"]')?.getAttribute("content");
    expect(desc?.length).toBeGreaterThan(50);
    for (const p of others) {
      const d = new DOMParser().parseFromString(p.html, "text/html");
      expect(d.title, p.route).not.toBe(page.title);
      expect(d.querySelector('meta[name="description"]')?.getAttribute("content"), p.route).not.toBe(desc);
    }
  });

  it("is in the sitemap", () => {
    expect(sitemapPaths()).toContain(route);
  });

  it("has one h1 and a heading outline without skips", () => {
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    const levels = [...main.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1], `h${level} after h${levels[i - 1]}`).toBeLessThanOrEqual(1);
    });
  });

  // Astro can drop the space between a word and a link written on the next line.
  it("keeps a space between words and the links beside them", () => {
    const html = main.innerHTML;
    expect(html.match(/[A-Za-z,]<a\b[^>]*>[^<]{0,40}/g) ?? []).toEqual([]);
    expect(html.match(/<\/a>[A-Za-z][^<]{0,40}/g) ?? []).toEqual([]);
  });

  it("follows the house writing rules in its own words", () => {
    expect(text(main)).not.toMatch(/—|\s–\s/);
  });

  // The 30 s limit: axe on a long page can pass 5 s when the Mac is busy.
  it("passes axe (structure and ARIA; color contrast needs a browser)", { timeout: 30_000 }, async () => {
    document.documentElement.innerHTML = page.documentElement.innerHTML;
    for (const { name, value } of page.documentElement.attributes) document.documentElement.setAttribute(name, value);
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe.each(GUIDE_SLUGS)("/guides/%s/ items", (slug) => {
  const page = doc(`guides/${slug}/index.html`);
  const items = [...page.querySelectorAll<HTMLElement>("main [data-guide-item]")];
  const ld = JSON.parse(page.querySelector("script[type='application/ld+json']")?.textContent ?? "{}");

  it("lists active records only, each once", () => {
    const ids = items.map((li) => li.dataset.id ?? "");
    expect(ids.filter((id) => !active.has(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("links each item to the organization's own URL and to its Startup Resources entry", () => {
    for (const li of items) {
      const id = li.dataset.id ?? "";
      const hrefs = [...li.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(hrefs, id).toEqual([active.get(id)?.url, `/ecosystem-canvas/#r-${id}`]);
      expect(canvasAnchors.has(`r-${id}`), id).toBe(true);
    }
  });

  it("names every item in the ItemList, in page order", () => {
    expect(ld.itemListElement.map((e: { url: string }) => e.url)).toEqual(items.map((li) => li.querySelector("a")?.getAttribute("href")));
    expect(ld.itemListElement.map((e: { name: string }) => e.name)).toEqual(items.map((li) => text(li.querySelector("a"))));
  });

  it("keeps the lists out of the search index, so a search finds each resource on the directory", () => {
    for (const list of page.querySelectorAll("main ul[data-guide-list]")) {
      expect(list.closest("[data-pagefind-ignore]")).not.toBeNull();
    }
  });
});

// Step F (2026-11-15): each guide answers with a chart, one row per part of
// the answer, in place of its long lists. Each row counts its listings and
// links the Startup Resources view, or the region page, that holds them.
describe.each(GUIDE_SLUGS)("/guides/%s/ chart", (slug) => {
  const page = doc(`guides/${slug}/index.html`);
  const main = page.querySelector("main")!;
  const chart = main.querySelector("[data-guide-diagram]");
  const rows = [...main.querySelectorAll<HTMLElement>("[data-guide-row]")];

  it("follows the answer in the first section, with its source and date in the caption", () => {
    expect(chart?.closest("section")).toBe(main.querySelector("section"));
    const answer = main.querySelector("[data-guide-answer]")!;
    expect(answer.compareDocumentPosition(chart!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const caption = chart!.querySelector("figcaption");
    expect(text(caption)).toMatch(/^Listings in Startup Resources, as of .+\.$/);
    expect(caption?.querySelector("time")?.getAttribute("datetime")).toBe(answer.querySelector("time")?.getAttribute("datetime"));
  });

  it("gives every row a name, a count and a bar, and links it to Startup Resources or a region page", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const n = Number(text(row.querySelector("[data-guide-count]")).match(/^\d+/)?.[0]);
      expect(n, row.dataset.guideRow).toBeGreaterThan(0);
      expect(text(row.querySelector("[data-guide-count] .visually-hidden")), row.dataset.guideRow).toBe(n === 1 ? "listing" : "listings");
      expect(row.querySelector(".guide-chart__bar")?.getAttribute("style"), row.dataset.guideRow).toMatch(/--share: (0|1)\.\d{4}/);
      const href = row.querySelector("a")?.getAttribute("href");
      if (href) expect(href, row.dataset.guideRow).toMatch(/^\/(ecosystem-canvas\/\?[a-z]+=|regions\/[a-z-]+\/$)/);
    }
    expect(rows.some((r) => r.querySelector("a")), "at least one row links").toBe(true);
  });

  it("lists no long list: five records at most, and a link to see more in Startup Resources", () => {
    expect(main.querySelectorAll("[data-guide-item]").length).toBeLessThanOrEqual(5);
    const more = [...main.querySelectorAll("section[data-guide-start] a")].find((a) => text(a) === "See more in Startup Resources");
    expect(more?.getAttribute("href")).toMatch(/^\/ecosystem-canvas\//);
  });
});

describe("/guides/start-a-company-in-colorado/ chart", () => {
  const main = doc("guides/start-a-company-in-colorado/index.html").querySelector("main")!;

  it("numbers its rows as steps, in the answer's order", () => {
    const list = main.querySelector("[data-guide-diagram] ol");
    expect(list).not.toBeNull();
    expect([...list!.querySelectorAll<HTMLElement>("[data-guide-row]")].map((r) => r.dataset.guideRow)).toEqual([
      "learn",
      "test",
      "local-help",
      "advisers",
    ]);
  });
});

describe("/guides/where-founders-meet/", () => {
  const main = doc("guides/where-founders-meet/index.html").querySelector("main")!;

  it("charts the places by region and links each region page", () => {
    for (const r of REGIONS) {
      const row = main.querySelector(`[data-guide-row='${r.id}']`);
      const link = row?.querySelector(`a[href='/regions/${r.id}/']`);
      expect(text(link), r.id).toBe(r.name);
    }
  });
});

describe("/guides/funding-programs/ (hard constraints 2 and 8)", () => {
  const main = doc("guides/funding-programs/index.html").querySelector("main")!;

  it("never links the Leaderboard and never talks about a Colorado Startups fund", () => {
    expect(main.querySelector("a[href^='/leaderboard']")).toBeNull();
    expect(text(main)).not.toMatch(/leaderboard/i);
    expect(text(main)).not.toMatch(/colorado startups\W+(?:\w+\W+){0,3}?(?:fund|invest)/i);
  });
});

describe("/ecosystem-canvas/ links the guides", () => {
  it("from its closing section", () => {
    const closing = doc("ecosystem-canvas/index.html").querySelector("section[aria-labelledby='missing-title']");
    expect(closing?.querySelector("a[href='/guides/']")).not.toBeNull();
  });
});
