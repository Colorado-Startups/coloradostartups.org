// L17: the brand guide's art and texture lines (scripts/artifacts/inline-page.mjs),
// which must follow what is in site/src/assets/art rather than a fixed sentence.
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDirs } from "../temp-dirs";
import { artStatusHtml, countArt, textureNoteHtml, texturesCss } from "../../../../scripts/artifacts/inline-page.mjs";

const ROOT = path.join(__dirname, "../../../..");
const tempDir = tempDirs();
const tmp = () => tempDir("l17-art-");

describe("artStatusHtml", () => {
  it("says the pages show placeholders when no art has landed", () => {
    expect(artStatusHtml(0)).toMatch(/^no rendered art has landed/);
  });

  it("counts the art once it lands, in the right number, without overclaiming", () => {
    expect(artStatusHtml(13)).toMatch(/^13 art files have landed in <code>site\/src\/assets\/art\/<\/code>, and each page copy shows them where the page has an art slot\./);
    expect(artStatusHtml(1)).toMatch(/^1 art file has landed .*, and each page copy shows it where the page has an art slot\./);
    expect(artStatusHtml(13)).not.toMatch(/placeholder|every page/);
  });
});

describe("countArt", () => {
  it("counts only the extensions art-assets.ts loads (webp, png, jpg), in every subfolder", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "agents"));
    for (const f of ["a.webp", "b.png", "agents/c.jpg", "d.jpeg", "e.svg", "f.avif", "g.WEBP", "notes.txt"]) {
      writeFileSync(path.join(dir, f), "x");
    }
    expect(countArt(dir)).toBe(3);
    expect(countArt(path.join(dir, "missing"))).toBe(0);
  });
});

describe("texturesCss", () => {
  // `assets` stands in for site/src/assets; tiles live in assets/art/textures.
  function assetsRoot() {
    const root = tmp();
    const assets = path.join(root, "assets");
    const textures = path.join(assets, "art", "textures");
    mkdirSync(textures, { recursive: true });
    return { root, assets, textures };
  }

  it("is empty when no tile exists, so the flat colors show", () => {
    const { assets, textures } = assetsRoot();
    expect(texturesCss(textures, assets)).toBe("");
    expect(textureNoteHtml("")).toMatch(/when they land/);
  });

  it("inlines each tile that exists as the --tex-* properties the CSS reads (known clean)", () => {
    const { assets, textures } = assetsRoot();
    writeFileSync(path.join(textures, "stone.webp"), "RIFF");
    writeFileSync(path.join(textures, "night-stone.png"), "PNG");
    const css = texturesCss(textures, assets);
    expect(css).toMatch(/^:root\{--tex-stone:url\("data:image\/webp;base64,UklGRg=="\);--tex-night-stone:url\("data:image\/png;base64,UE5H"\)\}$/);
    expect(css).not.toMatch(/--tex-parchment/);
    expect(textureNoteHtml(css)).toMatch(/wear L7's texture tiles/);
  });

  it("takes the png when a tile has both, as HallTextures' sorted glob does", () => {
    const { assets, textures } = assetsRoot();
    writeFileSync(path.join(textures, "stone.webp"), "RIFF");
    writeFileSync(path.join(textures, "stone.png"), "PNG");
    expect(texturesCss(textures, assets)).toBe(':root{--tex-stone:url("data:image/png;base64,UE5H")}');
  });

  it("ignores files that are not one of HallTextures' three tiles", () => {
    const { assets, textures } = assetsRoot();
    writeFileSync(path.join(textures, "marble.webp"), "RIFF");
    expect(texturesCss(textures, assets)).toBe("");
  });

  it("refuses a tile that is a symlink to a file outside the assets folder (known bad)", () => {
    const { root, assets, textures } = assetsRoot();
    writeFileSync(path.join(root, "dev.vars"), "SECRET=1");
    symlinkSync(path.join(root, "dev.vars"), path.join(textures, "stone.webp"));
    expect(() => texturesCss(textures, assets)).toThrow(/not a regular file/);
  });

  it("refuses a tile folder outside the assets folder, or under a dot folder", () => {
    const { root, assets } = assetsRoot();
    const outside = path.join(root, "elsewhere");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "stone.webp"), "RIFF");
    expect(() => texturesCss(outside, assets)).toThrow(/outside/);
    const hidden = path.join(assets, ".cache", "textures");
    mkdirSync(hidden, { recursive: true });
    writeFileSync(path.join(hidden, "stone.webp"), "RIFF");
    expect(() => texturesCss(hidden, assets)).toThrow(/dotfile/);
  });
});

describe("ops/artifacts/brand.html", () => {
  const guide = readFileSync(path.join(ROOT, "ops/artifacts/brand.html"), "utf8");
  const globalCss = readFileSync(path.join(ROOT, "site/src/styles/global.css"), "utf8");

  // A declaration's value in the first rule whose selector list names `selector`,
  // with comments dropped and whitespace collapsed.
  function declaration(css: string, selector: string, property: string): string | undefined {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(",").map((s) => s.trim()).includes(selector)) continue;
      const decl = new RegExp(`(?:^|;)\\s*${property.replace(/-/g, "\\-")}\\s*:\\s*([^;]+);`).exec(m[2]);
      if (decl) return decl[1].replace(/\s+/g, " ").trim();
    }
    return undefined;
  }

  it("takes its art and texture lines from markers, not fixed sentences", () => {
    for (const marker of ["<!-- l16:art-status -->", "<!-- l16:textures-css -->", "<!-- l16:texture-note -->"]) {
      expect(guide, marker).toContain(marker);
    }
    expect(guide).not.toContain("no rendered art has landed");
  });

  it("paints its stone and night rooms with the same layers as global.css", () => {
    for (const [selector, property] of [
      [".section--stone", "background"],
      [".section--stone", "--_veil"],
      [".section--night", "background"],
    ]) {
      const site = declaration(globalCss, selector, property);
      expect(site, `${selector} ${property} in global.css`).toBeDefined();
      expect(declaration(guide, selector, property), `${selector} ${property}`).toBe(site);
    }
  });
});
