// L26: the badge kit's snippet, files and words, in plain Node. The snippet
// must link to the exact production URL, because a badge on someone else's
// site is only worth having if its link lands on coloradostartups.org.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { absolute, BADGE_SIZE, badgeFile, badgeSnippet, KIT_BADGES, SITE_ORIGIN } from "../../../src/components/kit/badges";
import { COPIED, COPY_FAILED, copyText } from "../../../src/components/kit/copy";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PUBLIC = path.join(SITE, "public");
const tokens = (parse(readFileSync(path.resolve(SITE, "..", "01_doctrine", "brand_tokens.yaml"), "utf8")) as {
  color: Record<string, string>;
}).color;
const TOKEN_HEX = new Set(Object.values(tokens).map((v) => v.toUpperCase()));

// Words a badge for an unranked edition must never carry.
const RANK_WORDS = /\b(top|best|fastest|leading|ranked|rank|winner|#\s?\d+|no\.\s?\d+|number one)\b/i;

/**
 * Everything wrong with a badge SVG: a color that is not a brand token, live
 * text (it would render in the visitor's fallback font), or anything that
 * runs or reaches outside the file.
 */
function svgProblems(svg: string): string[] {
  const out: string[] = [];
  for (const hex of svg.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
    if (!TOKEN_HEX.has(hex.toUpperCase())) out.push(`color ${hex} is not a brand token`);
  }
  if (/\b(rgb|hsl)a?\(/i.test(svg)) out.push("color function instead of a token hex");
  if (/<text\b/i.test(svg)) out.push("live <text>");
  if (/<(script|foreignObject|image|use|style|a)\b/i.test(svg)) out.push("element that runs, embeds or links");
  if (/\son[a-z]+\s*=/i.test(svg)) out.push("event handler attribute");
  if (/\b(xlink:)?href\s*=/i.test(svg)) out.push("href attribute");
  if (/url\((?!#)/i.test(svg)) out.push("url() outside the file");
  return out;
}

describe("svgProblems (self-test)", () => {
  it("passes a token-only, path-only sample (known clean)", () => {
    const clean = `<svg xmlns="http://www.w3.org/2000/svg"><clipPath id="a"><path d="M0 0H1Z"/></clipPath><g clip-path="url(#a)"><path fill="${tokens.night}" stroke="${tokens.accent}"/></g></svg>`;
    expect(svgProblems(clean)).toEqual([]);
  });

  it("flags an off-token color, live text, a script and an outside reference (known bad)", () => {
    const bad = `<svg><path fill="#123456"/><text>Top 10</text><script>alert(1)</script><path onclick="x" fill="url(https://e.example/a)"/></svg>`;
    const problems = svgProblems(bad);
    expect(problems).toContain("color #123456 is not a brand token");
    expect(problems).toContain("live <text>");
    expect(problems).toContain("element that runs, embeds or links");
    expect(problems).toContain("event handler attribute");
    expect(problems).toContain("url() outside the file");
  });
});

describe("the badge snippet", () => {
  it("uses the production origin the site is built for", () => {
    expect(SITE_ORIGIN).toBe("https://coloradostartups.org");
    const config = readFileSync(path.join(SITE, "astro.config.mjs"), "utf8");
    expect(config).toContain(`site: "${SITE_ORIGIN}"`);
  });

  it("links the Leaderboard badge to exactly https://coloradostartups.org/leaderboard/", () => {
    const badge = KIT_BADGES.find((b) => b.id === "leaderboard-2026-honoree")!;
    expect(badgeSnippet(badge)).toBe(
      '<a href="https://coloradostartups.org/leaderboard/">' +
        '<img src="https://coloradostartups.org/badges/leaderboard-2026-honoree.svg" ' +
        'alt="2026 Colorado Startups Leaderboard honoree" width="300" height="100"></a>',
    );
  });

  it("links the Startup Resources badge to exactly https://coloradostartups.org/ecosystem-canvas/", () => {
    const badge = KIT_BADGES.find((b) => b.id === "startup-resources-listed")!;
    expect(badgeSnippet(badge)).toBe(
      '<a href="https://coloradostartups.org/ecosystem-canvas/">' +
        '<img src="https://coloradostartups.org/badges/startup-resources-listed.svg" ' +
        'alt="Listed in Colorado Startups Startup Resources" width="300" height="100"></a>',
    );
  });

  it("names exactly the two badges the kit offers, each with one link and no rel", () => {
    expect(KIT_BADGES.map((b) => b.id)).toEqual(["leaderboard-2026-honoree", "startup-resources-listed"]);
    for (const badge of KIT_BADGES) {
      const html = badgeSnippet(badge);
      expect(html.match(/<a\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/\brel=/);
      expect(html).not.toMatch(/\btarget=/);
    }
  });

  it("escapes an attribute value, so a quote in alt text cannot break the tag", () => {
    const html = badgeSnippet({ ...KIT_BADGES[0]!, alt: 'A "quoted" <b>name</b> & more' });
    expect(html).toContain('alt="A &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt; &amp; more"');
  });

  it("makes root-relative paths absolute on the production origin", () => {
    expect(absolute("/leaderboard/")).toBe("https://coloradostartups.org/leaderboard/");
    expect(absolute("/badges/x.svg")).toBe("https://coloradostartups.org/badges/x.svg");
  });
});

describe("the badge words", () => {
  it.each(KIT_BADGES.map((b) => [b.id, b] as const))("%s names no rank, in alt text or on the badge", (_id, badge) => {
    for (const words of [badge.name, badge.alt, ...Object.values(badge.lines)]) {
      expect(words, words).not.toMatch(RANK_WORDS);
    }
  });

  it.each(KIT_BADGES.map((b) => [b.id, b] as const))("%s has plain alt text that names Colorado Startups", (_id, badge) => {
    expect(badge.alt).toContain("Colorado Startups");
    expect(badge.alt).not.toMatch(/[<>"&]/);
    expect(badge.alt).not.toMatch(/^(image|picture|logo|badge) of/i);
  });

  it("says 2026 honoree on the Leaderboard badge and listed on the Startup Resources badge", () => {
    expect(KIT_BADGES[0]!.alt).toBe("2026 Colorado Startups Leaderboard honoree");
    expect(KIT_BADGES[1]!.alt).toBe("Listed in Colorado Startups Startup Resources");
  });
});

describe("the badge files in site/public/badges/", () => {
  const { width, height } = BADGE_SIZE;

  it.each(KIT_BADGES.map((b) => [b.id, b] as const))("%s has an SVG of the badge size, made of brand tokens and paths only", (_id, badge) => {
    const file = path.join(PUBLIC, badgeFile(badge, "svg"));
    expect(existsSync(file), file).toBe(true);
    const svg = readFileSync(file, "utf8");
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(svg).toContain(`<title id="${badge.id}-title">${badge.alt}</title>`);
    expect(svgProblems(svg)).toEqual([]);
  });

  it.each(KIT_BADGES.map((b) => [b.id, b] as const))("%s has PNGs at 1x and 2x", async (_id, badge) => {
    for (const [format, scale] of [["png", 1], ["png2x", 2]] as const) {
      const file = path.join(PUBLIC, badgeFile(badge, format));
      expect(existsSync(file), file).toBe(true);
      const meta = await sharp(file).metadata();
      expect([meta.format, meta.width, meta.height], file).toEqual(["png", width * scale, height * scale]);
      expect(meta.hasAlpha, file).toBe(true);
    }
  });
});

describe("copyText", () => {
  it("writes to the clipboard and says so", async () => {
    const written: string[] = [];
    expect(await copyText("<a></a>", { writeText: async (t) => void written.push(t) })).toBe(true);
    expect(written).toEqual(["<a></a>"]);
  });

  it("returns false with no clipboard, or when the clipboard refuses", async () => {
    expect(await copyText("x", undefined)).toBe(false);
    expect(await copyText("x", { writeText: () => Promise.reject(new Error("denied")) })).toBe(false);
  });

  it("tells the visitor what to do next in both cases", () => {
    expect(COPIED).toMatch(/^Copied\./);
    expect(COPY_FAILED).toContain("copy it");
  });
});
