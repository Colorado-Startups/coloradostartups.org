import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { SOURCE } from "../../../scripts/sync-brand.mjs";

// The contrast block in 01_doctrine/brand_tokens.yaml is the record of every
// text and UI pairing the Hall uses. This test recomputes each WCAG 2.2 ratio
// from the hex values, so a color edit that breaks a pairing, or a ratio typed
// by hand, fails here.

interface Pairing {
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

const doc = parse(readFileSync(SOURCE, "utf8")) as { color: Record<string, string>; contrast: Pairing[] };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast math (self-test)", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("fails a known-bad pairing: gold text on the daylight ground", () => {
    expect(contrast(doc.color.accent, doc.color.ground)).toBeLessThan(3);
  });
});

describe("brand_tokens.yaml contrast block", () => {
  it("is present and names only declared colors", () => {
    expect(doc.contrast.length).toBeGreaterThan(0);
    for (const { fg, bg } of doc.contrast) {
      expect(doc.color, `unknown color ${fg}`).toHaveProperty(fg);
      expect(doc.color, `unknown color ${bg}`).toHaveProperty(bg);
    }
  });

  it.each(doc.contrast.map((p) => [`${p.fg} on ${p.bg}`, p] as const))("%s meets its minimum", (_label, p) => {
    const actual = contrast(doc.color[p.fg], doc.color[p.bg]);
    expect(actual).toBeGreaterThanOrEqual(p.min);
    // The recorded ratio is rounded to two places; it must match the colors.
    expect(Math.abs(actual - p.ratio)).toBeLessThan(0.006);
  });

  it("covers every ink role that sits on a light ground", () => {
    const inks = ["text", "text-dim", "link", "community", "danger", "on-accent", "on-bronze", "pine", "focus"];
    const covered = new Set(doc.contrast.map((p) => p.fg));
    for (const ink of inks) expect(covered, `no contrast entry for ${ink}`).toContain(ink);
  });

  it("covers every ink role that sits on night", () => {
    const inks = ["on-night", "on-night-dim", "gold-on-night", "focus-on-night", "danger-on-night"];
    const onNight = new Set(doc.contrast.filter((p) => p.bg === "night").map((p) => p.fg));
    for (const ink of inks) expect(onNight, `no contrast entry for ${ink} on night`).toContain(ink);
  });
});

// Texture limits: the darkest pixel a light tile may paint (its floor), or the
// lightest a dark tile may paint (its ceiling), with the CSS veil and then any
// tint composited over it the way a browser does (per channel, in sRGB).
interface TextureLimit {
  floor?: string;
  ceiling?: string;
  veil: string;
  opacity: number;
  tint?: string;
  tint_opacity?: number;
  inks: string[];
}
const textures = (parse(readFileSync(SOURCE, "utf8")) as { texture: Record<string, TextureLimit> }).texture;

function composite(top: string, alpha: number, bottom: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const mixed = [1, 3, 5].map((i) => Math.round(channel(top, i) * alpha + channel(bottom, i) * (1 - alpha)));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function worstCase(t: TextureLimit): string {
  const limit = doc.color[(t.floor ?? t.ceiling) as string];
  const veiled = composite(doc.color[t.veil], t.opacity, limit);
  return t.tint ? composite(doc.color[t.tint], t.tint_opacity ?? 0, veiled) : veiled;
}

// A focus ring is a UI part (3:1); every other ink is text (4.5:1).
const minimumFor = (ink: string) => (ink.startsWith("focus") ? 3 : 4.5);

// Every place that paints a texture: the two stylesheets and the footer,
// which paints night-stone under its own lantern tint.
const STYLES = ["src/styles/global.css", "src/styles/hall.css", "src/components/ui/SiteFooter.astro"].map((path) => ({
  path,
  css: readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
}));

// Declaration blocks that paint a given texture, from any of STYLES.
function blocksPainting(name: string): { path: string; body: string }[] {
  return STYLES.flatMap((s) =>
    [...s.css.matchAll(/\{([^{}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => body.includes(`var(--tex-${name},`))
      .map((body) => ({ path: s.path, body })),
  );
}

describe("brand_tokens.yaml texture limits", () => {
  it("fails a known-bad floor: links over stone-edge under a half veil (3.90:1)", () => {
    expect(contrast(doc.color.link, composite(doc.color.stone, 0.5, doc.color["stone-edge"]))).toBeLessThan(4.5);
  });

  it("fails a known-bad ceiling: gold text over a night tile lifted to bronze (3.64:1)", () => {
    expect(contrast(doc.color["gold-on-night"], doc.color.bronze)).toBeLessThan(4.5);
  });

  it.each(Object.entries(textures))("%s names exactly one limit, a floor or a ceiling", (_name, t) => {
    expect(Number(Boolean(t.floor)) + Number(Boolean(t.ceiling))).toBe(1);
    for (const role of [t.floor ?? t.ceiling, t.veil, t.tint, ...t.inks].filter(Boolean)) {
      expect(doc.color, `unknown color ${role}`).toHaveProperty(role as string);
    }
  });

  it.each(Object.entries(textures))("%s keeps every ink at its minimum over the worst-case pixel", (name, t) => {
    const worst = worstCase(t);
    for (const ink of t.inks) {
      expect(contrast(doc.color[ink], worst), `${ink} on the ${name} limit`).toBeGreaterThanOrEqual(minimumFor(ink));
    }
  });

  it.each(Object.entries(textures))("every block that paints %s lays the recorded veil over it", (name, t) => {
    const blocks = blocksPainting(name);
    expect(blocks.length, `nothing paints ${name}`).toBeGreaterThan(0);
    if (t.opacity === 0) return;
    const veil = `color-mix(in oklab, var(--c-${t.veil}) ${Math.round(t.opacity * 100)}%, transparent)`;
    for (const b of blocks) {
      const sheet = STYLES.find((s) => s.path === b.path)?.css ?? "";
      expect(sheet, `${b.path} paints ${name} without the veil`).toContain(veil);
    }
  });

  it.each(Object.entries(textures))("no block tints %s more than the recorded tint", (name, t) => {
    const allowed = Math.round((t.tint_opacity ?? 0) * 100);
    for (const tint of [t.tint].filter(Boolean)) {
      for (const b of blocksPainting(name)) {
        const strengths = [...b.body.matchAll(new RegExp(`var\\(--c-${tint}\\) (\\d+)%`, "g"))].map((m) => Number(m[1]));
        for (const pct of strengths) expect(pct, `${b.path} tints ${name} at ${pct}%`).toBeLessThanOrEqual(allowed);
      }
    }
  });
});
