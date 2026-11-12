import { describe, expect, it } from "vitest";

import {
  allowedUrl,
  assetFileName,
  extractAssetUrls,
  fetchAllowed,
  MAX_REDIRECTS,
  originalImageUrl,
  pageFileName,
  parseSitemap,
  // @ts-expect-error plain .mjs ops module without type declarations
} from "../../../../ops/squarespace/backup-lib.mjs";

const HOST = "coloradostartups.org";

const SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc>https://coloradostartups.org/home</loc><lastmod>2026-06-18</lastmod>
  <image:image><image:loc>https://images.squarespace-cdn.com/content/v1/abc/hero.jpg</image:loc><image:title>Hero &amp; crowd</image:title></image:image>
</url>
<url><loc>https://coloradostartups.org/links</loc></url>
</urlset>`;

describe("parseSitemap", () => {
  it("reads pages, lastmod and images with decoded titles", () => {
    expect(parseSitemap(SITEMAP)).toEqual([
      {
        page: "https://coloradostartups.org/home",
        lastmod: "2026-06-18",
        images: [{ url: "https://images.squarespace-cdn.com/content/v1/abc/hero.jpg", title: "Hero & crowd" }],
      },
      { page: "https://coloradostartups.org/links", lastmod: "", images: [] },
    ]);
  });
});

describe("allowedUrl", () => {
  it("allows the site and Squarespace image hosts over https only", () => {
    expect(allowedUrl("https://coloradostartups.org/x", HOST)).not.toBeNull();
    expect(allowedUrl("https://images.squarespace-cdn.com/a.jpg", HOST)).not.toBeNull();
    expect(allowedUrl("http://coloradostartups.org/x", HOST)).toBeNull();
    expect(allowedUrl("https://evil.example/a.jpg", HOST)).toBeNull();
    expect(allowedUrl("https://images.squarespace-cdn.com.evil.example/a.jpg", HOST)).toBeNull();
    expect(allowedUrl("not a url", HOST)).toBeNull();
  });
});

describe("extractAssetUrls", () => {
  it("finds src, data-src, srcset and /s/ file links, and skips plain page links", () => {
    const html = `
      <img src="https://images.squarespace-cdn.com/content/v1/abc/one.png?format=500w">
      <img data-src="//images.squarespace-cdn.com/content/v1/abc/two.jpg">
      <img srcset="/assets/three.webp 1x, /assets/three@2x.webp 2x">
      <a href="/s/deck.pdf">Deck</a>
      <a href="/team">Team</a>`;
    expect(extractAssetUrls(html, "https://coloradostartups.org/home").sort()).toEqual([
      "https://coloradostartups.org/assets/three.webp",
      "https://coloradostartups.org/assets/three@2x.webp",
      "https://coloradostartups.org/s/deck.pdf",
      "https://images.squarespace-cdn.com/content/v1/abc/one.png?format=500w",
      "https://images.squarespace-cdn.com/content/v1/abc/two.jpg",
    ]);
  });
});

describe("file naming", () => {
  it("asks the CDN for the original once per image", () => {
    expect(originalImageUrl("https://images.squarespace-cdn.com/content/v1/abc/one.png?format=500w")).toBe(
      "https://images.squarespace-cdn.com/content/v1/abc/one.png?format=original",
    );
    expect(originalImageUrl("https://coloradostartups.org/s/deck.pdf")).toBe("https://coloradostartups.org/s/deck.pdf");
  });
  it("names pages by slug and assets by a stable hash plus basename", () => {
    expect(pageFileName("https://coloradostartups.org/")).toBe("pages/home.html");
    expect(pageFileName("https://coloradostartups.org/the-team")).toBe("pages/the-team.html");
    const a = assetFileName("https://images.squarespace-cdn.com/content/v1/abc/My Photo.jpg?format=original");
    expect(a).toMatch(/^images\/[0-9a-f]{8}-My-Photo\.jpg$/);
    expect(assetFileName("https://images.squarespace-cdn.com/content/v1/xyz/My Photo.jpg")).not.toBe(a);
  });
});

describe("fetchAllowed (redirects followed by hand)", () => {
  // A fake fetch: each URL maps to [status, Location?]. Records every request.
  function fakeFetch(routes: Record<string, [number, string?]>) {
    const seen: { url: string; redirect: unknown }[] = [];
    const impl = async (url: string, init: { redirect?: unknown }) => {
      seen.push({ url, redirect: init.redirect });
      const [status, location] = routes[url] ?? [404];
      return new Response(status === 200 ? "ok" : null, { status, headers: location ? { Location: location } : {} });
    };
    return { impl, seen };
  }
  const START = "https://coloradostartups.org/s/deck.pdf";

  it("follows allowed hops, relative ones included, and never lets fetch redirect on its own", async () => {
    const f = fakeFetch({
      [START]: [301, "/s/deck-v2.pdf"],
      "https://coloradostartups.org/s/deck-v2.pdf": [302, "https://static1.squarespace.com/x/deck.pdf"],
      "https://static1.squarespace.com/x/deck.pdf": [200],
    });
    const res = await fetchAllowed(START, HOST, {}, f.impl);
    expect(res.status).toBe(200);
    expect(f.seen.map((r) => r.url)).toEqual([
      START,
      "https://coloradostartups.org/s/deck-v2.pdf",
      "https://static1.squarespace.com/x/deck.pdf",
    ]);
    expect(f.seen.every((r) => r.redirect === "manual")).toBe(true);
  });

  it.each([
    ["another host", "https://evil.example/deck.pdf"],
    ["plain http", "http://coloradostartups.org/s/deck.pdf"],
    ["a lookalike host", "https://images.squarespace-cdn.com.evil.example/a.jpg"],
  ])("refuses a redirect to %s without fetching it", async (_label, target) => {
    const f = fakeFetch({ [START]: [302, target] });
    await expect(fetchAllowed(START, HOST, {}, f.impl)).rejects.toThrow(/refused/);
    expect(f.seen).toHaveLength(1);
  });

  it("refuses a disallowed starting URL and stops after the hop limit", async () => {
    await expect(fetchAllowed("https://evil.example/x", HOST, {}, fakeFetch({}).impl)).rejects.toThrow(/refused/);
    const loop = fakeFetch({ [START]: [302, START] });
    await expect(fetchAllowed(START, HOST, {}, loop.impl)).rejects.toThrow(/redirects/);
    expect(loop.seen).toHaveLength(MAX_REDIRECTS + 1);
  });
});
