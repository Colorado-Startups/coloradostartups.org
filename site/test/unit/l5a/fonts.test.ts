import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// L5a and brand v3 type (Colorado-Startups/brand tokens/type.yaml): Aileron is
// the one web font, for h1 and h2; body text is Trebuchet MS, a system font the
// brand never ships. The lab numbers live in e2e/l5a.spec.ts; this holds the
// wiring, since a misspelled family name fails silently in a browser.

const SITE = path.join(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(SITE, file), "utf8");
const CONFIG = read("astro.config.mjs");
const GLOBAL = read("src/styles/global.css");

describe("brand v3 type", () => {
  it("loads Aileron, and only Aileron, as a web font for --font-display", () => {
    const names = [...CONFIG.matchAll(/^\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(names).toEqual(["Aileron"]);
    expect(CONFIG).toMatch(/provider:\s*fontProviders\.fontsource\(\)/);
    expect(CONFIG).toMatch(/cssVariable:\s*"--font-display"/);
    expect(CONFIG).not.toMatch(/cssVariable:\s*"--font-body"/);
  });

  it("lets Astro size Aileron's fallback, and keeps the swap", () => {
    expect(CONFIG).not.toMatch(/optimizedFallbacks:\s*false/);
    expect(CONFIG).not.toMatch(/display:\s*"optional"/);
  });

  it("sets body text in Trebuchet MS, with stand-ins where it is missing", () => {
    const stack = GLOBAL.match(/--font-body:\s*([^;]+);/)?.[1] ?? "";
    expect(stack.split(",")[0]!.trim()).toBe('"Trebuchet MS"');
    expect(stack.trim().endsWith("sans-serif")).toBe(true);
  });

  it("has no custom fallback faces left from Cinzel and Alegreya Sans", () => {
    expect(existsSync(path.join(SITE, "src/styles/fonts.css"))).toBe(false);
    expect(GLOBAL).not.toMatch(/fonts\.css/);
    expect(`${CONFIG}${GLOBAL}`).not.toMatch(/Cinzel|Alegreya/);
  });
});

describe("what every page loads first", () => {
  it("preloads only Aileron 700, the face h1 and h2 draw", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    expect(layout).toMatch(/<Font cssVariable="--font-display" preload=\{\[\{ weight: 700, style: "normal" \}\]\} \/>/);
    expect(layout).not.toMatch(/--font-body/);
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
