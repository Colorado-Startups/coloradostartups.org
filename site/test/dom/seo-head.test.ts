import { beforeAll, describe, expect, it } from "vitest";

import { contentPages } from "./pages";

// What search engines read from each page's <head> (GO-LIVE B5). Every
// indexable page (no robots noindex) needs a title, a meta description and a
// canonical naming its own URL, and no two indexable pages share a title. A
// noindex page names no canonical. The home page also carries the old site's
// two Google site-verification tags (GO-LIVE B9). Run `npm run build` first;
// test:content does.

const ORIGIN = "https://coloradostartups.org";
// Read from the old Squarespace home page with curl on 2026-10-18. Two Search
// Console properties verify by these tags, and DNS holds neither.
const GOOGLE_VERIFICATION = [
  "MasSRxNF93yU-Ejfs2kjL-sEXttLYOLkZV-3CtlkBHY",
  "F7Z7mKLCmYVKSVe98UjyfnvYoTKlnuy8snAhkuMUXfQ",
];

export interface HeadFacts {
  route: string;
  noindex: boolean;
  title: string;
  description: string;
  canonical: string | null;
  verification: string[];
}

/** The search-relevant head tags of one page, from one parse. */
export function readHead({ route, html }: { route: string; html: string }): HeadFacts {
  const head = new DOMParser().parseFromString(html, "text/html").head;
  const robots = head.querySelector("meta[name='robots']")?.getAttribute("content") ?? "";
  return {
    route,
    noindex: /\bnoindex\b/i.test(robots),
    title: (head.querySelector("title")?.textContent ?? "").trim(),
    description: (head.querySelector("meta[name='description']")?.getAttribute("content") ?? "").trim(),
    canonical: head.querySelector("link[rel='canonical']")?.getAttribute("href") ?? null,
    verification: [...head.querySelectorAll("meta[name='google-site-verification']")].map(
      (meta) => meta.getAttribute("content") ?? "",
    ),
  };
}

/** What is wrong with the pages' head tags; empty when every page is right. */
export function headProblems(pages: readonly HeadFacts[]): string[] {
  const problems: string[] = [];
  const titled = new Map<string, string>();
  for (const { route, noindex, title, description, canonical } of pages) {
    if (noindex) {
      if (canonical !== null) problems.push(`${route}: noindex page has a canonical (${canonical})`);
      continue;
    }
    if (!title) problems.push(`${route}: no title`);
    if (!description) problems.push(`${route}: no meta description`);
    if (canonical !== `${ORIGIN}${route}`) problems.push(`${route}: canonical is ${canonical ?? "missing"}, want ${ORIGIN}${route}`);
    const first = titled.get(title);
    if (title && first) problems.push(`${route}: title "${title}" is also on ${first}`);
    else if (title) titled.set(title, route);
  }
  return problems;
}

/** The verification tokens a page lacks; empty when it carries them all. */
export function missingVerification(page: HeadFacts, tokens: readonly string[]): string[] {
  return tokens.filter((token) => !page.verification.includes(token));
}

const page = (route: string, head: string) =>
  readHead({ route, html: `<!doctype html><html><head>${head}</head><body></body></html>` });
const indexable = (route: string, title: string) =>
  page(
    route,
    `<title>${title}</title><meta name="description" content="About ${title}">` +
      `<link rel="canonical" href="${ORIGIN}${route}">`,
  );
const noindexed = (route: string, extra = "") =>
  page(route, `<title>Not found</title><meta name="description" content="x"><meta name="robots" content="noindex">${extra}`);

describe("headProblems", () => {
  it("passes indexable pages with unique titles and a noindex page with no canonical (known clean)", () => {
    expect(headProblems([indexable("/", "Home"), indexable("/team/", "Team"), noindexed("/404.html")])).toEqual([]);
  });

  it("flags a duplicate title (known bad)", () => {
    expect(headProblems([indexable("/a/", "Same"), indexable("/b/", "Same")])).toEqual([
      '/b/: title "Same" is also on /a/',
    ]);
  });

  it("flags a missing title, a missing description and a wrong canonical (known bad)", () => {
    const bare = page("/a/", `<title> </title><link rel="canonical" href="${ORIGIN}/b/">`);
    expect(headProblems([bare])).toEqual([
      "/a/: no title",
      "/a/: no meta description",
      `/a/: canonical is ${ORIGIN}/b/, want ${ORIGIN}/a/`,
    ]);
    expect(headProblems([page("/c/", "<title>C</title><meta name='description' content='c'>")])).toEqual([
      `/c/: canonical is missing, want ${ORIGIN}/c/`,
    ]);
  });

  it("flags a noindex page that names a canonical (known bad)", () => {
    const stray = noindexed("/404.html", `<link rel="canonical" href="${ORIGIN}/404/">`);
    expect(headProblems([stray])).toEqual([`/404.html: noindex page has a canonical (${ORIGIN}/404/)`]);
  });
});

describe("missingVerification", () => {
  const tag = (token: string) => `<meta name="google-site-verification" content="${token}">`;
  it("passes a page with both tags (known clean)", () => {
    expect(missingVerification(page("/", tag("a") + tag("b")), ["a", "b"])).toEqual([]);
  });
  it("names the tag a page lacks (known bad)", () => {
    expect(missingVerification(page("/", tag("a")), ["a", "b"])).toEqual(["b"]);
    expect(missingVerification(page("/", tag("b-typo")), ["b"])).toEqual(["b"]);
  });
});

describe("<head> search tags on the built pages", () => {
  let built: HeadFacts[] = [];
  // One parse per built page, here rather than in each test: under load on a
  // laptop, parsing every page inside one test passed the 5 s test default
  // (seen 2026-10-18).
  beforeAll(() => {
    built = contentPages().map(readHead);
  }, 120_000);

  it("checks real pages: more than 10 are indexable", () => {
    expect(built.filter((p) => !p.noindex).length).toBeGreaterThan(10);
  });

  it("gives /404.html noindex and no canonical", () => {
    const notFound = built.find((p) => p.route === "/404.html");
    expect(notFound).toMatchObject({ noindex: true, canonical: null });
  });

  it("carries both Google site-verification tags on the home page", () => {
    const home = built.find((p) => p.route === "/");
    expect(home).toBeDefined();
    expect(missingVerification(home!, GOOGLE_VERIFICATION)).toEqual([]);
  });

  it("has a title, a description and its own canonical on every indexable page, and unique titles", () => {
    expect(headProblems(built)).toEqual([]);
  });
});
