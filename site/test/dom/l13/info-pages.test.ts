import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { WAYS_IN } from "@cs/shared";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { CONDUCT_GROUPS } from "../../../src/components/info/code-of-conduct";
import {
  calendarEmbedUrl,
  CONTACT_EMAIL,
  LUMA_CS,
  LUMA_SCP,
  POSTAL_ADDRESS,
} from "../../../src/components/info/links";
import { DRAFT_NOTICE, isDraftPolicy } from "../../../src/components/info/privacy";
import { NEWSLETTER_NAME } from "../../../src/components/newsletter/copy";
import { keeperNames, undisclosedKeeperSentences } from "../../unit/l29/keeper-disclosure";
import { builtPages, DIST_DIR, readDist, SITE_DIR, sitemapPaths } from "../pages";

// L13's pages as they ship: built HTML from dist/ (run `npm run build` first;
// test:content does). Color contrast and the 375 px layout run in the browser
// (e2e/l13.spec.ts); jsdom cannot lay out a page.

const doc = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const main = (d: Document) => d.querySelector("main")!;

const PAGES = [
  { route: "/newsletter/", file: "newsletter/index.html" },
  { route: "/newsletter/thanks/", file: "newsletter/thanks/index.html" },
  { route: "/event-calendar/", file: "event-calendar/index.html" },
  { route: "/code-of-conduct/", file: "code-of-conduct/index.html" },
  { route: "/contact/", file: "contact/index.html" },
  { route: "/privacy/", file: "privacy/index.html" },
  { route: "/404.html", file: "404.html" },
];

describe.each(PAGES)("$route", ({ file }) => {
  it("has exactly one h1 and a heading outline without skips", () => {
    const d = doc(file);
    expect(d.querySelectorAll("h1")).toHaveLength(1);
    const levels = [...main(d).querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1], `heading h${level} after h${levels[i - 1]}`).toBeLessThanOrEqual(1);
    });
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
    // axe reads the global document (its title, its landmarks), so load the
    // page into it. innerHTML never runs the page's scripts.
    const page = doc(file).documentElement;
    document.documentElement.innerHTML = page.innerHTML;
    for (const { name, value } of page.attributes) document.documentElement.setAttribute(name, value);
    // iframes: false, because the calendar's frame is Google's markup, not ours.
    const results = await axe.run(document, { iframes: false, rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  // Astro drops the line break between a word and a link on the next line, so
  // "email\n<a>" renders as "emailinfo@...". Pages add {" "} where they wrap.
  it("keeps a space between words and the links beside them", () => {
    const html = main(doc(file)).innerHTML;
    expect(html.match(/[A-Za-z,]<a\b[^>]*>[^<]{0,40}/g) ?? []).toEqual([]);
    expect(html.match(/<\/a>[A-Za-z][^<]{0,40}/g) ?? []).toEqual([]);
  });

  it("ships no HTML comments in its main content", () => {
    expect(main(doc(file)).innerHTML).not.toMatch(/<!--/);
  });
});

describe("/newsletter/", () => {
  const d = doc("newsletter/index.html");

  it("names the newsletter Startupers (decision 23)", () => {
    expect(text(d.querySelector("h1"))).toBe(NEWSLETTER_NAME);
  });

  it("carries the sign-up form, returning errors here", () => {
    const form = d.querySelector<HTMLFormElement>("form[data-newsletter]");
    expect(form?.getAttribute("action")).toBe("/api/subscribe");
    expect(form?.querySelector<HTMLInputElement>('input[name="return_to"]')?.value).toBe("/newsletter/");
  });

  it("points to the LinkedIn delivery on the LinkedIn Page", () => {
    const hrefs = [...main(d).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(WAYS_IN["linkedin-page"]);
  });
});

describe("/newsletter/thanks/", () => {
  const d = doc("newsletter/thanks/index.html");

  it("says the contract's words", () => {
    expect(text(d.querySelector("h1"))).toBe("Check your inbox");
    // The lede, not the first p: the kicker above the h1 is a p too (#419).
    expect(text(main(d).querySelector("p.lede"))).toBe(
      "We sent a confirmation link to your email. Click it to start getting Startupers, the Colorado Startups newsletter, every other Tuesday from Nov 17, 2026. Already subscribed? You are all set, and no second email is coming.",
    );
    const back = [...main(d).querySelectorAll("a")].find((a) => text(a) === "Back to the Hall");
    expect(back?.getAttribute("href")).toBe("/");
  });

  it("stays out of search and the sitemap", () => {
    expect(d.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    expect(sitemapPaths()).not.toContain("/newsletter/thanks/");
  });
});

describe("/event-calendar/", () => {
  const d = doc("event-calendar/index.html");
  const hrefs = [...main(d).querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

  it("embeds the Google Calendar with a title and lazy loading", () => {
    const frame = main(d).querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(calendarEmbedUrl());
    expect(frame.getAttribute("title")).toMatch(/calendar/i);
    expect(frame.getAttribute("loading")).toBe("lazy");
  });

  it("says the embed may set Google cookies, next to the embed", () => {
    expect(text(d.querySelector(".calendar figcaption"))).toMatch(/Google may set cookies/);
  });

  it("links Luma and points Hikes and Ski Days to the Startup Community Project", () => {
    expect(hrefs).toContain(LUMA_CS);
    const scp = d.getElementById("hikes-and-ski-days")!;
    expect(text(scp)).toMatch(/Startup Hikes/);
    expect(text(scp)).toMatch(/Startup Ski Days/);
    expect([...scp.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(LUMA_SCP);
  });

  it("takes event submissions by email, with the address shown as text", () => {
    const link = [...main(d).querySelectorAll('a[href^="mailto:"]')].find((a) => text(a) === CONTACT_EMAIL);
    expect(link?.getAttribute("href")).toMatch(new RegExp(`^mailto:${CONTACT_EMAIL}\\?subject=`));
    expect(d.getElementById("add-your-event")).not.toBeNull();
  });
});

describe("/code-of-conduct/", () => {
  const d = doc("code-of-conduct/index.html");

  it("shows every rule, grouped, in order", () => {
    const h3s = [...main(d).querySelectorAll("h3")].map(text);
    expect(h3s).toEqual(CONDUCT_GROUPS.flatMap((g) => g.rules.map((r) => r.title)));
    for (const g of CONDUCT_GROUPS) expect(text(d.getElementById(g.id))).toBe(g.heading);
  });

  it("links each group from the on-page contents", () => {
    const toc = [...d.querySelectorAll('nav[aria-label="On this page"] a')].map((a) => a.getAttribute("href"));
    for (const g of CONDUCT_GROUPS) expect(toc).toContain(`#${g.id}`);
  });

  it("says people moderate, not the AI agents (decision 43)", () => {
    expect(text(d.getElementById("report")?.parentElement)).toMatch(/People moderate our groups\. Our AI agents never do\./);
  });
});

describe("/contact/", () => {
  const d = doc("contact/index.html");

  it("shows the inbox as text with a mailto link", () => {
    const link = main(d).querySelector(`a[href="mailto:${CONTACT_EMAIL}"]`);
    expect(text(link)).toBe(CONTACT_EMAIL);
  });

  it("gives the postal address, the same one the footer prints", () => {
    const address = main(d).querySelector("address")!;
    const lines = address.innerHTML.split(/<br\b[^>]*>/).map((l) => l.replace(/<[^>]+>/g, "").trim());
    expect(lines).toEqual([...POSTAL_ADDRESS]);
    const footer = text(d.querySelector(".site-footer"));
    for (const line of POSTAL_ADDRESS) expect(footer).toContain(line);
  });
});

describe("/privacy/", () => {
  const d = doc("privacy/index.html");
  const source = readFileSync(path.join(SITE_DIR, "../data/legal/privacy.md"), "utf8");

  it("renders data/legal/privacy.md", () => {
    const sourceHeadings = [...source.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    const pageHeadings = [...main(d).querySelectorAll(".prose h2")].map(text);
    expect(pageHeadings).toEqual(sourceHeadings);
    expect(text(d.querySelector("h1"))).toBe("Privacy Policy");
  });

  it("shows the draft notice exactly while the frontmatter status is not approved", () => {
    const frontmatter = parse(source.split(/^---$/m)[1]) as { status?: "draft" | "approved" };
    const notice = main(d).querySelector('[role="note"]');
    if (isDraftPolicy(frontmatter.status)) expect(text(notice)).toContain(DRAFT_NOTICE.title);
    else expect(notice).toBeNull();
  });

  it("keeps the postal address on separate lines", () => {
    const contact = [...main(d).querySelectorAll(".prose p")].find((p) => p.textContent?.includes("951 20th Street"))!;
    expect(contact.querySelectorAll("br")).toHaveLength(2);
  });

  it("keeps reviewer comments out of the page source", () => {
    expect(readDist("privacy/index.html")).not.toMatch(/<!--\s*DRAFT/);
  });
});

describe("404", () => {
  const d = doc("404.html");

  it("links home and to Startup Resources", () => {
    const hrefs = [...main(d).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/");
    expect(hrefs).toContain(WAYS_IN.canvas);
  });

  it("stays out of search", () => {
    expect(d.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
  });
});

describe("sitemap", () => {
  it("lists the public info pages", () => {
    const paths = sitemapPaths();
    for (const route of ["/newsletter/", "/event-calendar/", "/code-of-conduct/", "/contact/", "/privacy/"]) {
      expect(paths).toContain(route);
    }
  });
});

describe("robots.txt", () => {
  const robots = readDist("robots.txt");

  it("allows every crawler on the public site", () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
  });

  // Decision 68 (the crawler policy). A group named for one bot replaces the
  // * group for that bot, so it would lose the disallows below. One group
  // carries everything. robots.txt itself cites no decision number: it is public.
  it("keeps one group, with the content signals and both disallows inside it", () => {
    expect(robots.match(/^User-agent:/gim)).toHaveLength(1);
    // The group runs from its User-agent line to the first blank line.
    const group = robots.split(/^User-agent: \*$/m)[1]?.split("\n\n")[0] ?? "";
    expect(group).toMatch(/^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m);
    expect(group).toMatch(/^Disallow: \/styleguide\/$/m);
    expect(group).toMatch(/^Disallow: \/api\/$/m);
    expect(robots, "a public file cites no internal decision").not.toMatch(/\bdecision\s+\d/i);
  });

  it("points to the sitemap the build writes", () => {
    expect(robots).toMatch(/^Sitemap: https:\/\/coloradostartups\.org\/sitemap-index\.xml$/m);
    expect(existsSync(path.join(DIST_DIR, "sitemap-index.xml"))).toBe(true);
  });
});

describe("llms.txt", () => {
  const llms = readDist("llms.txt");
  const links = [...llms.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)/gm)].map((m) => ({ title: m[1], url: m[2] }));

  it("follows the llms.txt shape: a title, a summary, then link lists", () => {
    expect(llms.split("\n")[0]).toBe("# Colorado Startups");
    expect(llms).toMatch(/^> Colorado Startups is a community of entrepreneurs building companies in Colorado\./m);
    expect(links.length).toBeGreaterThan(0);
  });

  it("leads with founders", () => {
    expect(llms.match(/^## (.+)$/m)?.[1]).toBe("For founders");
  });

  it("links only absolute coloradostartups.org URLs", () => {
    for (const { url } of links) expect(url).toMatch(/^https:\/\/coloradostartups\.org\//);
  });

  // A route is real when the build wrote it (a page, or a file such as
  // /data/resources.json that no page links), a built page links to it (the
  // shared header and footer link every planned page), or a region file
  // defines it. That catches a typo without a hand-kept list of routes.
  it("points only at routes the site builds or links", () => {
    const known = new Set(builtPages().map((p) => p.route));
    for (const page of builtPages()) {
      for (const m of page.html.matchAll(/\bhref="(\/[^"#?]*)/g)) known.add(m[1]);
    }
    const regionsDir = path.join(SITE_DIR, "../data/regions");
    for (const f of readdirSync(regionsDir).filter((n: string) => n.endsWith(".yaml"))) {
      known.add(`/regions/${(parse(readFileSync(path.join(regionsDir, f), "utf8")) as { id: string }).id}/`);
    }
    const builtFile = (route: string) => {
      const file = path.join(DIST_DIR, route);
      return existsSync(file) && statSync(file).isFile();
    };
    for (const { url } of links) {
      const route = new URL(url).pathname;
      expect(known.has(route) || builtFile(route), url).toBe(true);
    }
  });

  // GO-LIVE C5: the machine-readable data and the Leaderboard's method, for AI
  // assistants that read llms.txt before the pages.
  it("links the Startup Resources data, both feeds and the Leaderboard method", () => {
    const urls = links.map((l) => l.url);
    for (const url of [
      "https://coloradostartups.org/data/resources.json",
      "https://coloradostartups.org/feed.json",
      "https://coloradostartups.org/rss.xml",
      "https://coloradostartups.org/leaderboard/#method",
    ]) {
      expect(urls).toContain(url);
    }
    const leaderboard = doc("leaderboard/index.html");
    expect(leaderboard.getElementById("method"), "the #method anchor exists").not.toBeNull();
  });

  it("lists every public L13 page", () => {
    const paths = links.map((l) => new URL(l.url).pathname);
    for (const route of ["/newsletter/", "/event-calendar/", "/code-of-conduct/", "/contact/", "/privacy/"]) {
      expect(paths).toContain(route);
    }
  });

  // L29: every sentence that names a keeper says "AI agent" itself, so no
  // sentence lifted out of llms.txt names a keeper without the disclosure. The
  // check and its self-test live in test/unit/l29/keeper-disclosure.
  it("discloses the keepers as AI agents, in every sentence that names one", () => {
    const keepers = keeperNames();
    expect(keepers.length).toBeGreaterThan(0);
    expect(undisclosedKeeperSentences(llms, keepers)).toEqual([]);
  });

  it("follows the house writing rules", () => {
    expect(llms).not.toMatch(/—|\s–\s/);
  });
});
