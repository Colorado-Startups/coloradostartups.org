import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// L5a and brand v3.1 type (Colorado-Startups/brand dist/brand.json `type`):
// Aileron for h1 and h2, Atkinson Hyperlegible for text, both web fonts through
// Fontsource. The lab numbers live in e2e/l5a.spec.ts; this holds the wiring,
// since a misspelled family name fails silently in a browser.

const SITE = path.join(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(SITE, file), "utf8");
const CONFIG = read("astro.config.mjs");
const GLOBAL = read("src/styles/global.css");

describe("brand v3 type", () => {
  it("loads Aileron for --font-display and Atkinson Hyperlegible for --font-body, both from Fontsource", () => {
    const fonts = [...CONFIG.matchAll(/provider:\s*fontProviders\.(\w+)\(\),\s*name:\s*"([^"]+)",\s*cssVariable:\s*"([^"]+)"/g)].map((m) => m.slice(1));
    expect(fonts).toEqual([
      ["fontsource", "Aileron", "--font-display"],
      ["fontsource", "Atkinson Hyperlegible", "--font-body"],
    ]);
  });

  it("lets Astro size each font's fallback, and keeps the swap", () => {
    expect(CONFIG).not.toMatch(/optimizedFallbacks:\s*false/);
    expect(CONFIG).not.toMatch(/display:\s*"optional"/);
  });

  it("leaves --font-body to the Astro Fonts API, with no hand-set stack", () => {
    expect(GLOBAL).not.toMatch(/--font-body:/);
    expect(GLOBAL).not.toMatch(/Trebuchet/);
  });

  it("has no custom fallback faces left from Cinzel and Alegreya Sans", () => {
    expect(existsSync(path.join(SITE, "src/styles/fonts.css"))).toBe(false);
    expect(GLOBAL).not.toMatch(/fonts\.css/);
    expect(`${CONFIG}${GLOBAL}`).not.toMatch(/Cinzel|Alegreya/);
  });
});

describe("what every page loads first", () => {
  it("preloads only Aileron 700 and Atkinson Hyperlegible 400 and 700, the faces the first screen draws", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    expect(layout).toMatch(/<Font cssVariable="--font-display" preload=\{\[\{ weight: 700, style: "normal" \}\]\} \/>/);
    expect(layout).toMatch(/<Font cssVariable="--font-body" preload=\{\[\{ weight: 400, style: "normal" \}, \{ weight: 700, style: "normal" \}\]\} \/>/);
  });

  it("draws the brand emblem at 44 px from its small webps, eagerly", () => {
    const header = read("src/components/ui/SiteHeader.astro");
    expect(header).toMatch(/brandArt\("brand\/emblem-512"\)/);
    expect(header).toMatch(/<img src=\{emblem\.src\} srcset=\{emblem\.srcset\} sizes="44px" width="44" height="44"[^>]*loading="eager"/);
    expect(header).not.toMatch(/cs-logo/);
  });

  it("links the brand icon set and the manifest", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    for (const href of ["/art/brand/favicon.ico", "/art/brand/icon-192.png", "/art/brand/apple-touch-icon.png", "/site.webmanifest"]) {
      expect(layout, href).toContain(`href="${href}"`);
    }
    const manifest = JSON.parse(read("public/site.webmanifest")) as { icons: { src: string }[]; theme_color: string };
    expect(manifest.theme_color).toBe("#001970");
    for (const icon of manifest.icons) expect(existsSync(path.join(SITE, "public", icon.src)), icon.src).toBe(true);
  });

  it("names a theme color for each system theme, from the tokens", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    expect(layout).toContain('<meta name="color-scheme" content="light dark" />');
    expect(layout).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content={themeLight} />');
    expect(layout).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content={themeDark} />');
    expect(layout).toContain("const themeLight = tokens.color.text;");
    expect(layout).toContain("const themeDark = tokens.night.ground;");
    expect(layout).not.toMatch(/name="theme-color" content="#/);
  });
});
