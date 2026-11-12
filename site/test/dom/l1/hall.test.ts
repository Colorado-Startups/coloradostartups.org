import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { REGION_IDS, WAYS_IN } from "@cs/shared";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { STARTUP_COMMUNITY_PROJECT_URL } from "../../../src/components/hall/channels";
import { builtPages, DIST_DIR, readDist, SITE_DIR } from "../pages";

// L1: the Hall front as it ships. Built HTML from dist/ (run `npm run build`
// first; test:content does). Color contrast needs a real browser, so it runs
// in e2e/l1.spec.ts; everything else is checked here.

const PAGES = {
  home: "index.html",
  community: "community/index.html",
  links: "links/index.html",
  founders: "founders/index.html",
} as const;
type PageKey = keyof typeof PAGES;

const doc = (key: PageKey) => new DOMParser().parseFromString(readDist(PAGES[key]), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const yamlFile = <T>(rel: string) => parse(readFileSync(path.join(SITE_DIR, "..", rel), "utf8")) as T;

const TAGLINE = "A community of founders building companies in Colorado.";

// Routes other lanes own and build (00_project_system/lanes/README.md).
// A link from these pages may point at one before that lane's PR merges.
const OTHER_LANE_ROUTES = new Set([
  "/regions/",
  ...REGION_IDS.map((id) => `/regions/${id}/`),
  "/team/",
  "/get-involved/",
  "/dispatches/",
  "/newsletter/",
  "/event-calendar/",
  "/code-of-conduct/",
  "/contact/",
  "/privacy/",
]);
// Every outside host these pages may link to.
const EXTERNAL_HOSTS = new Set(["www.linkedin.com", "docs.google.com", "luma.com"]);
// Short links that the built _redirects sends off the site with a 302: the
// Slack sign-up (#128). redirects.test.ts checks where they land.
const OFF_SITE_SHORT_LINKS = new Set(
  readDist("_redirects")
    .split("\n")
    .filter((line) => line.endsWith(" 302"))
    .map((line) => line.split(" ")[0]),
);

describe("home page", () => {
  const home = doc("home");
  const main = home.querySelector("main")!;

  it("leads with the name and the tagline, in the lede and the meta description", () => {
    expect(text(home.querySelector("h1"))).toBe("Colorado Startups");
    expect(text(home.querySelector(".hero .lede")).startsWith(TAGLINE)).toBe(true);
    expect(home.querySelector('meta[name="description"]')?.getAttribute("content")?.startsWith(TAGLINE)).toBe(true);
  });

  it("lists the four ways in, each through WAYS_IN", () => {
    const hrefs = [...main.querySelectorAll(".ways-in .way-action")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([WAYS_IN.slack, WAYS_IN["linkedin-group"], WAYS_IN["linkedin-page"], WAYS_IN.newsletter]);
  });

  it("places the compact welcome desk and the compact Resourcus panel", () => {
    expect(main.querySelector('.welcome-desk[data-compact="true"]')).not.toBeNull();
    expect(main.querySelector('[data-resourcus][data-compact="true"]')).not.toBeNull();
  });

  it("teases Startup Resources and the Leaderboard, and never ties the Leaderboard to investing", () => {
    const resources = main.querySelector('[data-teaser="resources"]')!;
    const leaderboard = main.querySelector('[data-teaser="leaderboard"]')!;
    expect(resources.querySelector(`a[href="${WAYS_IN.canvas}"]`)).not.toBeNull();
    expect(leaderboard.querySelector(`a[href="${WAYS_IN.leaderboard}"]`)).not.toBeNull();
    expect(text(leaderboard)).not.toMatch(/invest|fund|capital/i);
  });

  // #186: the home cards were a copy of RegionCard with a CSS ridge where the
  // art goes. They are RegionCard now, so they match /regions/, art included.
  it("shows each region as the same card /regions/ shows, with its art", () => {
    const regionsPage = new DOMParser().parseFromString(readDist("regions/index.html"), "text/html");
    for (const id of REGION_IDS) {
      const card = main.querySelector(`[data-region='${id}']`);
      expect(card?.querySelector("[data-art] img"), id).not.toBeNull();
      expect(text(card), id).toBe(text(regionsPage.querySelector(`[data-region='${id}']`)));
    }
  });

  it("teases the three regions from data/regions, in order, each linking to its page", () => {
    const regions = REGION_IDS.map((id) => yamlFile<{ id: string; name: string; order: number }>(`data/regions/${id}.yaml`))
      .sort((a, b) => a.order - b.order);
    const cards = [...main.querySelectorAll("[data-region]")];
    expect(cards.map((c) => c.getAttribute("data-region"))).toEqual(regions.map((r) => r.id));
    for (const [i, card] of cards.entries()) {
      expect(text(card.querySelector("h3"))).toBe(regions[i]!.name);
      expect(card.querySelector(`a[href="/regions/${regions[i]!.id}/"]`)).not.toBeNull();
    }
  });

  it("teases every keeper with its own AI disclosure from dwarves.yaml", () => {
    const keepers = yamlFile<{ id: string; name: string; disclosure: string }[]>("data/team/dwarves.yaml");
    const cards = [...main.querySelectorAll("[data-keeper]")];
    expect(cards).toHaveLength(keepers.length);
    for (const keeper of keepers) {
      const card = main.querySelector(`[data-keeper="${keeper.id}"]`);
      expect(text(card?.querySelector("h3"))).toBe(keeper.name);
      expect(text(card?.querySelector(".ai-note"))).toBe(keeper.disclosure);
    }
  });

  it("points to the founders forum", () => {
    expect(main.querySelector('a[href="/founders/"]')).not.toBeNull();
  });
});

describe("Organization and WebSite JSON-LD on the home page", () => {
  const home = doc("home");
  const blocks = [...home.querySelectorAll('script[type="application/ld+json"]')];
  const ld = JSON.parse(blocks[0]?.textContent ?? "{}") as Record<string, unknown>;
  const graph = (ld["@graph"] ?? []) as Record<string, unknown>[];
  const org = graph.find((n) => n["@type"] === "Organization") ?? {};
  const site = graph.find((n) => n["@type"] === "WebSite") ?? {};

  it("ships exactly one block, and it parses to a graph of the Organization and the WebSite", () => {
    expect(blocks).toHaveLength(1);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite"]);
  });

  it("gives the WebSite the Organization as publisher, by @id", () => {
    expect(org["@id"]).toBe("https://coloradostartups.org/#organization");
    expect(site["@id"]).toBe("https://coloradostartups.org/#website");
    expect(site.url).toBe("https://coloradostartups.org/");
    expect(site.publisher).toEqual({ "@id": org["@id"] });
  });

  it("has a name, url, logo, address and sameAs of the right shape", () => {
    expect(org.name).toBe("Colorado Startups");
    expect(org.url).toBe("https://coloradostartups.org/");
    const logo = new URL(org.logo as string);
    expect(logo.origin).toBe("https://coloradostartups.org");
    expect(existsSync(path.join(DIST_DIR, logo.pathname)), "the logo file ships in dist/").toBe(true);
    const address = org.address as Record<string, string>;
    expect(address["@type"]).toBe("PostalAddress");
    for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]) {
      expect(address[key], key).toBeTruthy();
    }
    expect(org.sameAs).toEqual([WAYS_IN["linkedin-page"], WAYS_IN["linkedin-group"], "https://github.com/Colorado-Startups"]);
  });

  it("gives the same postal address the footer prints", () => {
    const address = org.address as Record<string, string>;
    const footer = text(home.querySelector(".site-footer"));
    expect(footer).toContain(address.streetAddress);
    expect(footer).toContain(`${address.addressLocality}, ${address.addressRegion} ${address.postalCode}`);
  });

  it("appears on no other page", () => {
    for (const key of ["community", "links", "founders"] as const) {
      expect(doc(key).querySelector('script[type="application/ld+json"]'), key).toBeNull();
    }
  });
});

describe("community page", () => {
  const community = doc("community");
  const main = community.querySelector("main")!;

  it("puts founders first, then the startup community that backs them", () => {
    const audiences = [...main.querySelectorAll("[data-audience]")].map((el) => el.getAttribute("data-audience"));
    expect(audiences).toEqual(["founders", "backers"]);
    const backers = text(main.querySelector('[data-audience="backers"]'));
    for (const who of ["Talent", "Investors and lenders", "Service providers"]) expect(backers).toContain(who);
  });

  it("sends service providers' offers to the Wednesday Asks and Offers thread", () => {
    const backers = main.querySelector('[data-audience="backers"]')!;
    const providers = [...backers.querySelectorAll("dt")].find((dt) => text(dt) === "Service providers");
    expect(text(providers?.nextElementSibling)).toMatch(/Wednesday Asks and Offers thread/);
  });

  it("gives every channel what to expect, its norms and a way in", () => {
    const channels = [...main.querySelectorAll("[data-channel]")];
    expect(channels.map((c) => c.getAttribute("data-channel"))).toEqual([
      "slack",
      "linkedin-group",
      "linkedin-page",
      "newsletter",
      "events",
      "founders-forum",
    ]);
    for (const c of channels) {
      expect(c.querySelector("h3")).not.toBeNull();
      expect(c.querySelectorAll(".norms li").length).toBeGreaterThan(0);
      expect(c.querySelector("a.action")?.getAttribute("href")).toBeTruthy();
    }
  });

  it("discloses Communitas as an AI agent where the Slack card names it", () => {
    const dwarves = yamlFile<{ id: string; disclosure: string }[]>("data/team/dwarves.yaml");
    const slack = main.querySelector('[data-channel="slack"]')!;
    expect(text(slack)).toContain("Communitas");
    expect(text(slack.querySelector(".ai-note"))).toBe(dwarves.find((d) => d.id === "communitas")!.disclosure);
  });

  it("links the Code of Conduct", () => {
    expect(main.querySelector('a[href="/code-of-conduct/"]')).not.toBeNull();
  });

  it("lists every open community and region seat from positions.yaml, community-wide seats first", () => {
    const positions = yamlFile<{ title: string; area: string; region?: string; status: string }[]>(
      "data/team/positions.yaml",
    );
    const open = positions.filter((p) => p.status === "open" && ["community", "region"].includes(p.area));
    const seats = [...main.querySelectorAll("[data-seats] li strong")].map((s) => text(s).replace(/\.$/, ""));
    expect([...seats].sort()).toEqual(open.map((p) => p.title).sort());
    const firstRegion = seats.findIndex((title) => open.find((p) => p.title === title)?.area === "region");
    const lastCommunity = seats.findLastIndex((title) => open.find((p) => p.title === title)?.area === "community");
    expect(lastCommunity).toBeLessThan(firstRegion);
    // Region seats follow the regions' own order.
    const regionSeats = seats.slice(firstRegion).map((title) => open.find((p) => p.title === title)!.region);
    const regionOrder = REGION_IDS.map((id) => yamlFile<{ id: string; order: number }>(`data/regions/${id}.yaml`))
      .sort((a, b) => a.order - b.order)
      .map((r) => r.id)
      .filter((id) => regionSeats.includes(id));
    expect(regionSeats).toEqual(regionOrder);
    expect(main.querySelector('a[href="/get-involved/"]')).not.toBeNull();
  });

  it("places the full welcome desk and a newsletter form that returns here", () => {
    expect(main.querySelector('.welcome-desk[data-compact="false"]')).not.toBeNull();
    expect(main.querySelector("form[data-newsletter]")?.getAttribute("data-return-to")).toBe("/community/");
  });
});

describe("links page", () => {
  const links = doc("links");
  const main = links.querySelector("main")!;

  it("opens the Slack sign-up through the /slack/ short link, and says it is a Google Form", () => {
    const entry = main.querySelector("[data-slack-entry] a.btn");
    expect(entry?.getAttribute("href")).toBe(WAYS_IN.slack);
    expect(text(entry)).toBe("Join the Slack");
    expect(text(main.querySelector(`#${entry?.getAttribute("aria-describedby")}`))).toBe("Opens a Google Form.");
  });

  // #128: the form's URL lives only in ops/redirects/map.csv, so no page links
  // it and the backend can change in that one row.
  it("leaves the form's URL to the redirect map: no page links it", () => {
    // Read as text: map.mjs resolves its path from a file: URL, which jsdom lacks.
    const map = readFileSync(path.join(SITE_DIR, "../ops/redirects/map.csv"), "utf8");
    const form = /^\/slack,([^,]+),/m.exec(map)?.[1] ?? "";
    expect(form).toMatch(/^https:\/\/docs\.google\.com\/forms\//);
    for (const page of builtPages()) {
      expect(page.html.includes(form), page.route).toBe(false);
      expect(page.html, page.route).not.toMatch(/launchpass\.com\/colorado-startups/);
    }
  });

  it("points Startup Hikes and Ski Days to the Startup Community Project", () => {
    expect(main.querySelector(`a[href="${STARTUP_COMMUNITY_PROJECT_URL}"]`)).not.toBeNull();
  });

  it("collects no data itself", () => {
    expect(main.querySelector("form, input, textarea, select")).toBeNull();
  });
});

describe("founders page", () => {
  const founders = doc("founders");
  const main = founders.querySelector("main")!;

  it("explains the private, founders-only forum and says it opens later", () => {
    expect(text(main)).toMatch(/private forum for founders/i);
    expect(text(main)).toMatch(/for founders only/);
    expect(text(main)).toMatch(/opens later/);
  });

  it("names no date", () => {
    expect(text(main)).not.toMatch(
      /\b20\d\d\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
  });

  it("has no form and collects no data", () => {
    expect(founders.querySelector("form, input, textarea, select")).toBeNull();
  });

  it("points to the Slack and the newsletter to hear first", () => {
    expect(main.querySelector(`a[href="${WAYS_IN.slack}"]`)).not.toBeNull();
    expect(main.querySelector(`a[href="${WAYS_IN.newsletter}"]`)).not.toBeNull();
  });
});

describe.each(Object.keys(PAGES) as PageKey[])("%s page, every page rule", (key) => {
  const page = doc(key);

  it("uses L12's buttons and cards: no stone button beside a gold one, every teaser a hall card", () => {
    const main = page.querySelector("main")!;
    expect(main.querySelectorAll(".btn--stone")).toHaveLength(0);
    for (const el of main.querySelectorAll("[data-way], [data-region], [data-keeper], [data-teaser], [data-channel]")) {
      expect(el.classList.contains("hall-card"), el.outerHTML.slice(0, 80)).toBe(true);
    }
  });

  it("states no member count", () => {
    expect(text(page.querySelector("main"))).not.toMatch(/\b\d[\d,.]*\s*\+?\s*(members|startupers|founders|people)\b/i);
  });

  it("links only to pages that exist or that another lane builds, and to known outside hosts", () => {
    for (const a of page.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")!;
      if (href.startsWith("#")) continue;
      const url = new URL(href, "https://coloradostartups.org/");
      if (url.origin !== "https://coloradostartups.org") {
        expect(url.protocol, href).toBe("https:");
        expect(EXTERNAL_HOSTS.has(url.hostname), href).toBe(true);
        continue;
      }
      const file = path.join(DIST_DIR, url.pathname, url.pathname.endsWith("/") ? "index.html" : "");
      const built = existsSync(file) && statSync(file).isFile();
      expect(built || OTHER_LANE_ROUTES.has(url.pathname) || OFF_SITE_SHORT_LINKS.has(url.pathname), href).toBe(true);
    }
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser)", async () => {
    document.documentElement.innerHTML = page.documentElement.innerHTML;
    document.documentElement.setAttribute("lang", page.documentElement.getAttribute("lang") ?? "");
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

// Goal, from the L1 lane file: each page ships at most 75 KB of gzipped
// first-party JavaScript. Third-party scripts (Turnstile) load at run time and
// are not in dist/, so they are outside this count.
const JS_BUDGET_BYTES = 75 * 1024;

function jsGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/(?:import|from)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      queue.push(path.resolve(path.dirname(file), m[1]!));
    }
  }
  return seen;
}

describe.each(Object.keys(PAGES) as PageKey[])("%s page JavaScript", (key) => {
  it("fits the 75 KB gzipped goal", () => {
    const page = doc(key);
    const entries = [...page.querySelectorAll('script[src], link[rel="modulepreload"][href]')]
      .map((el) => el.getAttribute("src") ?? el.getAttribute("href")!)
      .filter((src) => src.startsWith("/"))
      .map((src) => path.join(DIST_DIR, src));
    let total = 0;
    for (const file of jsGraph(entries)) total += gzipSync(readFileSync(file)).length;
    expect(total).toBeLessThanOrEqual(JS_BUDGET_BYTES);
  });
});
