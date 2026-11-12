import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// L5a: size-matched font fallbacks for Android and Linux, two body preloads,
// and a logo drawn at its size. The lab numbers live in e2e/l5a.spec.ts; this
// holds the wiring, since a misspelled family name fails silently in a browser.

const SITE = path.join(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(SITE, file), "utf8");
const CONFIG = read("astro.config.mjs");
const FONTS = read("src/styles/fonts.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Each @font-face in fonts.css as its family, its local() names and whether it sets all four overrides. */
const faces = [...FONTS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
  family: m[1].match(/font-family:\s*"([^"]+)"/)?.[1],
  locals: [...m[1].matchAll(/local\("([^"]+)"\)/g)].map((l) => l[1]),
  overrides: ["size-adjust", "ascent-override", "descent-override", "line-gap-override"].every((p) => m[1].includes(`${p}:`)),
  range: m[1].match(/unicode-range:\s*([^;]+);/)?.[1] ?? "",
  weight: m[1].match(/font-weight:\s*([^;]+);/)?.[1],
  style: m[1].match(/font-style:\s*([^;]+);/)?.[1] ?? "normal",
}));

/** Whether a unicode-range covers one code point. */
function covers(range: string, codePoint: number): boolean {
  return range.split(",").some((part) => {
    const [lo, hi = lo] = part.trim().replace(/^U\+/i, "").split("-");
    return codePoint >= parseInt(lo!, 16) && codePoint <= parseInt(hi!, 16);
  });
}

/** The family names in each Astro font's fallbacks list that this repo defines. */
const custom = [...CONFIG.matchAll(/fallbacks:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+ Fallback [^"]+)"/g)].map((f) => f[1]));

describe("size-matched font fallbacks", () => {
  it("are listed in astro.config.mjs for both fonts", () => {
    expect(custom).toEqual(["Cinzel Fallback Liberation", "Alegreya Sans Fallback Arial", "Alegreya Sans Fallback Roboto"]);
  });

  it.each(custom)("%s has its faces in fonts.css, each with all four overrides", (family) => {
    const own = faces.filter((f) => f.family === family);
    expect(own.length).toBeGreaterThan(0);
    for (const face of own) expect(face.overrides).toBe(true);
  });

  it("reads a unicode-range (self-test)", () => {
    expect(covers("U+0000-00FF, U+2191", 0x41)).toBe(true);
    expect(covers("U+0000-00FF, U+2191", 0x2191)).toBe(true);
    expect(covers("U+0000-00FF, U+2191", 0x2192)).toBe(false);
  });

  it("cover only the web fonts' Latin subset, so a symbol neither font has draws at full size", () => {
    for (const face of faces) {
      expect(covers(face.range, 0x41), face.family).toBe(true);
      // → in links, ↕ ▲ ▼ on the leaderboard's sort buttons.
      for (const symbol of [0x2192, 0x2195, 0x25b2, 0x25bc]) expect(covers(face.range, symbol), `${face.family} U+${symbol.toString(16)}`).toBe(false);
    }
  });

  it("cover the fonts Android and Linux have", () => {
    const locals = faces.flatMap((f) => f.locals);
    expect(locals).toEqual(expect.arrayContaining(["Arial", "Arial Bold", "Liberation Sans", "Liberation Sans Bold", "Roboto", "Liberation Serif", "Liberation Serif Bold"]));
  });

  it("replace Astro's Alegreya fallback, which measured the italic file (#762)", () => {
    const alegreya = CONFIG.slice(CONFIG.indexOf('name: "Alegreya Sans"'), CONFIG.indexOf("},", CONFIG.indexOf('name: "Alegreya Sans"')));
    expect(alegreya).toMatch(/optimizedFallbacks:\s*false/);
    // One face per weight and style, each sized from its own file: italic
    // text is narrower than upright, so it needs faces of its own.
    const arial = faces.filter((f) => f.family === "Alegreya Sans Fallback Arial");
    expect(arial.map((f) => `${f.weight} ${f.style}`)).toEqual(["400 normal", "500 normal", "700 normal", "400 italic", "500 italic", "700 italic"]);
    for (const face of arial.filter((f) => f.style === "italic")) expect(face.locals.every((l) => /Italic/.test(l)), face.locals.join()).toBe(true);
  });

  it("keep both fonts on swap, so a late web font still replaces the fallback", () => {
    expect(CONFIG).not.toMatch(/display:\s*"optional"/);
  });

  it("load before hall.css and the rest of global.css", () => {
    expect(read("src/styles/global.css")).toMatch(/@import "\.\/tokens\.css";\s*@import "\.\/fonts\.css";/);
  });
});

describe("what every page loads first", () => {
  it("preloads only Alegreya Sans 400 and 700 normal, and Cinzel", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    expect(layout).toMatch(/<Font cssVariable="--font-display" preload \/>/);
    expect(layout).toMatch(/<Font cssVariable="--font-body" preload=\{\[\{ weight: 400, style: "normal" \}, \{ weight: 700, style: "normal" \}\]\} \/>/);
  });

  it("keeps both logo copies, the same bytes: <Image> imports src/assets, public/ serves the touch icon and feed", () => {
    const asset = readFileSync(path.join(SITE, "src/assets/brand/cs-logo-240.png"));
    expect(asset.equals(readFileSync(path.join(SITE, "public/brand/cs-logo-240.png")))).toBe(true);
  });

  it("draws the header logo through <Image> at 44 px, not the 240 px PNG", () => {
    const header = read("src/components/ui/SiteHeader.astro");
    expect(header).not.toMatch(/<img[^>]*cs-logo-240\.png/);
    expect(header).toMatch(/<Image src=\{logo\}[^>]*width=\{44\}[^>]*loading="eager"/);
  });
});
