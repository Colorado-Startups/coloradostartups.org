#!/usr/bin/env node
// Builds the badge kit's files in site/public/badges/ from badges.ts and the
// design tokens. Owner: L26.
//
//   node site/src/components/kit/build-badges.mjs           write the SVGs, PNGs and font record
//   node site/src/components/kit/build-badges.mjs --check   exit 1 if a committed SVG differs
//
// Inputs:
//   site/src/components/kit/badges.ts   the words, ids and size of each badge
//   01_doctrine/brand_tokens.yaml       every color (the one token source)
//   Cinzel and Alegreya Sans            the files the Astro Fonts API fetched on build
//                                       (site/dist/_astro/fonts, then the cache in
//                                       site/node_modules/.astro/fonts); run `npm run build` once first
//
// Output besides the badges: badge-fonts.json, beside this file, records the
// sha256 of each font file the badges were drawn with. Google Fonts does not
// always serve the same Cinzel for the same request: most builds get the
// variable file (wght 400 to 900), some get an instanced one (wght 600 to
// 700) with other outlines (#268). So --check and the badge test in
// site/test/dom/l26/kit.test.ts compare the SVGs only when the fonts they
// find are the recorded ones; otherwise they report "could not check".
//
// Text is set as vector paths from the font files, the way scripts/og/build.mjs
// sets the Open Graph cards. A badge loaded on someone else's site through
// <img> cannot fetch a web font, so live <text> would fall back to whatever
// that visitor has installed. The SVG holds no script, no link and no
// reference outside itself, so it is safe to serve from this origin.
// Exit codes: 0 built or clean, 1 a committed SVG is stale (--check), 2 usage
// error, 3 could not build or could not check (a font, package or input is
// missing, or a font differs from the recorded one).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import YAML from "yaml";

import { measure, pickFont, textEl as pathEl, textPath as glyphPath, xmlEscape } from "../../../../scripts/og/lib.mjs";
import { BADGE_SIZE, KIT_BADGES } from "./badges.ts";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOT = path.resolve(SITE, "..");
// The build's own copy first: the cache keeps every file any earlier build
// fetched, so it can hold two Cinzels where dist holds one.
const FONT_DIRS = ["dist/_astro/fonts", "node_modules/.astro/fonts"].map((d) => path.join(SITE, d));
export const OUT_DIR = path.join(SITE, "public/badges");
export const FONT_RECORD = path.join(path.dirname(fileURLToPath(import.meta.url)), "badge-fonts.json");

class CannotBuild extends Error {}

export function loadTokens() {
  return YAML.parse(fs.readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8")).color;
}

// Returns { title, kicker, status }, each { font, embolden, file, sha256 }.
// Candidates are read in FONT_DIRS order, then by file name, so the same
// folders always give the same pick (scripts/og/lib.mjs pickFont).
export async function loadFonts() {
  let fontkit;
  try {
    fontkit = await import("fontkitten");
  } catch {
    throw new CannotBuild("the fontkitten package is not installed; run npm ci at the repo root");
  }
  const fonts = [];
  for (const dir of FONT_DIRS.filter((d) => fs.existsSync(d))) {
    for (const f of fs.readdirSync(dir).filter((f) => /\.(woff2?|ttf|otf)$/.test(f)).sort()) {
      const bytes = fs.readFileSync(path.join(dir, f));
      try {
        const font = fontkit.create(bytes);
        fonts.push({ font, file: path.relative(SITE, path.join(dir, f)), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      } catch {
        // Not a font fontkitten can read; skip it.
      }
    }
  }
  const pick = (family, weight) => pickFont(fonts, family, weight);
  const set = { title: pick("Cinzel", 700), kicker: pick("Alegreya Sans", 700), status: pick("Alegreya Sans", 500) };
  const missing = Object.entries(set).filter(([, f]) => !f).map(([k]) => k);
  if (missing.length) {
    throw new CannotBuild(`could not find the ${missing.join(", ")} font(s); run \`npm run build\` once so the Astro Fonts API caches them`);
  }
  return set;
}

/** What badge-fonts.json holds: each role's family and the sha256 of its file. */
export function fontRecord(fonts) {
  return Object.fromEntries(Object.entries(fonts).map(([role, f]) => [role, { family: f.font.familyName, sha256: f.sha256 }]));
}

export function loadFontRecord() {
  try {
    return JSON.parse(fs.readFileSync(FONT_RECORD, "utf8"));
  } catch {
    return undefined;
  }
}

/** One line for each role whose font file is not the recorded one; empty when all match. */
export function fontMismatch(fonts, record) {
  if (!record) return [`${path.relative(ROOT, FONT_RECORD)} is missing or unreadable`];
  return Object.entries(fonts).flatMap(([role, f]) => {
    const want = record[role];
    if (f.sha256 === want?.sha256) return [];
    const found = `${f.font.familyName} in ${f.file} (sha256 ${f.sha256.slice(0, 12)})`;
    return [`the ${role} font is ${found}, not the ${want?.family ?? "unrecorded"} font the badges were drawn with (sha256 ${want?.sha256?.slice(0, 12) ?? "none"})`];
  });
}

/**
 * The GitHub annotation for a check that could not run, or undefined outside
 * GitHub Actions. A skip alone shows only in the skipped count, so a font
 * Google changed for good would go unseen run after run (#380). The text is
 * escaped the way 04_tools/ci_gate.sh escapes it, so it stays one command.
 */
export function couldNotCheckWarning(reason, env = process.env) {
  if (env.GITHUB_ACTIONS !== "true") return undefined;
  const text = `badges: could not check: ${reason}`.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::warning title=could not check (badge SVGs)::${text}`;
}

const round = (n) => Number(n.toFixed(2));
// A line's width, from the OG builder's shared measure.
const width = (face, text, size, spacing = 0) => measure(face, size, spacing)(text);
// One line as SVG path data, its coordinates rounded to 0.1 px, which keeps
// the file small and byte-stable across runs; at 2x that is a twentieth of a
// device pixel.
const textPath = (face, text, size, x, baseline, spacing = 0) =>
  glyphPath(face, text, size, x, baseline, spacing).replace(/-?\d+\.\d+/g, (n) => String(Number(Number(n).toFixed(1))));
// A text <path>, its stroke width written without trailing zeros.
const textEl = (face, d, size, fill) => pathEl(face, d, size, fill, round);

// A rectangle with its corners cut flat: the Hall's chamfer (radius.bevel).
function chamfer(x, y, w, h, c) {
  return `M${x + c} ${y}H${x + w - c}L${x + w} ${y + c}V${y + h - c}L${x + w - c} ${y + h}H${x + c}L${x} ${y + h - c}V${y + c}Z`;
}

// Layout, in CSS pixels on the 300 x 100 badge.
const L = {
  frameInset: 1.5,
  frameStroke: 3,
  frameCut: 12,
  ruleInset: 6.5,
  ruleCut: 9,
  tile: { x: 16, y: 18, size: 64, cut: 9 },
  textX: 94,
  textRight: 284,
  kicker: { size: 10.5, spacing: 1.6, baseline: 33 },
  title: { maxSize: 24, baseline: 59 },
  status: { size: 14, baseline: 79 },
};

/** The largest title size, up to the layout's maximum, at which every badge's title fits. */
export function titleSize(fonts, badges = KIT_BADGES) {
  const room = L.textRight - L.textX;
  const widest = Math.max(...badges.map((b) => width(fonts.title, b.lines.title, L.title.maxSize)));
  return round(Math.min(L.title.maxSize, (L.title.maxSize * room) / widest));
}

// The emblem: Front Range peaks under a rising sun, on a cut tile. Original
// geometry, drawn here; no franchise mark, rune or glyph.
function emblem(badge, c) {
  const { x, y, size, cut } = L.tile;
  const tileFill = badge.tile === "gold" ? c.accent : c.community;
  const sunFill = badge.tile === "gold" ? c.fire : c.accent;
  const at = (px, py) => `${round(x + (px / 64) * size)} ${round(y + (py / 64) * size)}`;
  const peaks = `M${at(-1, 66)}L${at(-1, 50)}L${at(18, 31)}L${at(27, 41)}L${at(39, 22)}L${at(65, 56)}L${at(65, 66)}Z`;
  const snow = `M${at(39, 22)}L${at(45.4, 30.4)}L${at(42, 29)}L${at(39, 32)}L${at(36, 29)}L${at(33.4, 30.2)}Z`;
  return [
    `<clipPath id="${badge.id}-tile"><path d="${chamfer(x, y, size, size, cut)}"/></clipPath>`,
    `<path d="${chamfer(x, y, size, size, cut)}" fill="${tileFill}"/>`,
    `<g clip-path="url(#${badge.id}-tile)">`,
    `<circle cx="${round(x + size / 2)}" cy="${round(y + (34 / 64) * size)}" r="${round((14 / 64) * size)}" fill="${sunFill}"/>`,
    `<path d="${peaks}" fill="${c.night}"/>`,
    `<path d="${snow}" fill="${c.ground}"/>`,
    `</g>`,
    // Redraws the tile's edge over the peaks, so the tile keeps its shape
    // where the night peaks meet the night ground of the badge.
    `<path d="${chamfer(x, y, size, size, cut)}" fill="none" stroke="${tileFill}" stroke-width="3"/>`,
  ].join("");
}

/** One badge as a complete, self-contained SVG document. */
export function renderBadgeSvg(badge, c, fonts) {
  const { width: W, height: H } = BADGE_SIZE;
  const t = titleSize(fonts);
  const { kicker, title, status } = badge.lines;
  const fi = L.frameInset;
  const ri = L.ruleInset;
  const titleId = `${badge.id}-title`;
  return (
    [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${titleId}">`,
      `<title id="${titleId}">${xmlEscape(badge.alt)}</title>`,
      `<path d="${chamfer(fi, fi, W - 2 * fi, H - 2 * fi, L.frameCut)}" fill="${c.night}" stroke="${c.accent}" stroke-width="${L.frameStroke}" stroke-linejoin="miter"/>`,
      `<path d="${chamfer(ri, ri, W - 2 * ri, H - 2 * ri, L.ruleCut)}" fill="none" stroke="${c["accent-ledge"]}" stroke-width="1"/>`,
      emblem(badge, c),
      textEl(fonts.kicker, textPath(fonts.kicker, kicker, L.kicker.size, L.textX, L.kicker.baseline, L.kicker.spacing), L.kicker.size, c["gold-on-night"]),
      textEl(fonts.title, textPath(fonts.title, title, t, L.textX, L.title.baseline), t, c["on-night"]),
      textEl(fonts.status, textPath(fonts.status, status, L.status.size, L.textX, L.status.baseline), L.status.size, c["on-night-dim"]),
      `</svg>`,
    ].join("\n") + "\n"
  );
}

function readCommitted(id) {
  const file = path.join(OUT_DIR, `${id}.svg`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/**
 * The committed SVGs against a fresh render. When a font is not the recorded
 * one, returns { couldNotCheck } naming it and compares nothing: other
 * outlines are not a stale badge. Otherwise returns { stale }, each
 * { id, committed, rendered } for a badge whose file differs.
 */
export function checkBadges({ fonts, tokens, record, badges = KIT_BADGES, read = readCommitted }) {
  const mismatch = fontMismatch(fonts, record);
  if (mismatch.length) return { couldNotCheck: mismatch.join("; "), stale: [] };
  const stale = badges.flatMap((b) => {
    const committed = read(b.id);
    const rendered = renderBadgeSvg(b, tokens, fonts);
    return committed === rendered ? [] : [{ id: b.id, committed, rendered }];
  });
  return { stale };
}

async function main(argv) {
  const check = argv.includes("--check");
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`badges: unknown argument ${unknown.join(" ")}`);
    return 2;
  }
  let fonts;
  try {
    fonts = await loadFonts();
  } catch (e) {
    if (e instanceof CannotBuild) {
      console.error(`badges: could not build: ${e.message}`);
      return 3;
    }
    throw e;
  }
  const c = loadTokens();
  if (check) {
    const { couldNotCheck, stale } = checkBadges({ fonts, tokens: c, record: loadFontRecord() });
    if (couldNotCheck) {
      console.error(`badges: could not check: ${couldNotCheck}`);
      const warning = couldNotCheckWarning(couldNotCheck);
      if (warning) console.log(warning);
      return 3;
    }
    for (const b of stale) console.error(`badges: ${b.id}.svg is stale; run node site/src/components/kit/build-badges.mjs`);
    return stale.length ? 1 : 0;
  }
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("badges: could not build: the sharp package is not installed; run npm ci at the repo root");
    return 3;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const b of KIT_BADGES) {
    const svg = renderBadgeSvg(b, c, fonts);
    fs.writeFileSync(path.join(OUT_DIR, `${b.id}.svg`), svg);
    for (const [suffix, scale] of [["", 1], ["-2x", 2]]) {
      const out = path.join(OUT_DIR, `${b.id}${suffix}.png`);
      await sharp(Buffer.from(svg), { density: 72 * scale })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(out);
      console.log(`badges: wrote ${path.relative(ROOT, out)}`);
    }
    console.log(`badges: wrote ${path.relative(ROOT, path.join(OUT_DIR, `${b.id}.svg`))}`);
  }
  fs.writeFileSync(FONT_RECORD, `${JSON.stringify(fontRecord(fonts), null, 2)}\n`);
  console.log(`badges: wrote ${path.relative(ROOT, FONT_RECORD)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
