#!/usr/bin/env node
// Builds the 1200 x 630 Open Graph cards in site/public/og/ from the design
// tokens, the Hall's art and the card copy.
//
//   node scripts/og/build.mjs                  every card in art/og/cards.txt
//   node scripts/og/build.mjs --only home,team  some cards
//
// Inputs:
//   art/og/cards.txt                 card copy (in art/ so the content gate scans it)
//   data/regions/<id>.yaml           name, tagline and art for the region cards (L8's data)
//   01_doctrine/brand_tokens.yaml    colors (the one token source)
//   site/src/assets/art/<key>.*      the card's art; falls back to hero/hall, and exits 3 without it.
//                                    A picture with keepers (lib.mjs isKeeperArt) gets an AI-agent
//                                    line above the URL unless the card's words already say so
//                                    Wide art covers the card; a portrait stands whole at the right
//   site/public/brand/cs-logo-240.png
//   Cinzel and Alegreya Sans         the files the Astro Fonts API caches on build
//                                    (site/node_modules/.astro/fonts); run `npm run build` once first
//
// Text is set as vector paths from the font files, so the cards never depend on
// the fonts installed on the machine. BaseLayout.astro links /og/<id>.png.
// Exit codes: 0 built, 1 a card is over the size goal, a keeper card's text
// lost its AI-agent disclosure, or its subtitle would run into the caption or
// URL (lib.mjs layoutProblem), 2 usage error, 3 could not build (a font,
// package or input is missing).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import YAML from "yaml";

import {
  CARD,
  CARD_TEXT,
  coverCrop,
  disclosureCaption,
  disclosureProblem,
  layoutProblem,
  measure,
  parseCards,
  parseFocus,
  pickFont,
  portraitPlacement,
  scrimStops,
  textEl,
  textLayout,
  textPath,
  wrapText,
  xmlEscape,
} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The build's own copy first, as the badge kit reads them: the cache keeps every
// file any earlier build fetched, so it can hold two Cinzels where dist holds one (#380).
const FONT_DIRS = ["site/dist/_astro/fonts", "site/node_modules/.astro/fonts"].map((d) => path.join(ROOT, d));
const ART_DIR = path.join(ROOT, "site/src/assets/art");
const OUT_DIR = path.join(ROOT, "site/public/og");
const LOGO = path.join(ROOT, "site/public/brand/cs-logo-240.png");
const FALLBACK_ART = "hero/hall";
const MAX_BYTES = 300 * 1024; // goal per card (orchestrator review of PR #2)

// Truecolor first; palette PNG with dithering only when a card runs over MAX_BYTES.
// If no encoding fits, the art behind the scrim is softened a little and the
// ladder runs again. Text is composited after the blur, so it stays sharp.
const SOFTEN = [0, 0.8, 1.5]; // px sigma on the background art only
const ENCODINGS = [
  { compressionLevel: 9, adaptiveFiltering: true },
  { compressionLevel: 9, palette: true, colors: 256, dither: 1 },
  { compressionLevel: 9, palette: true, colors: 192, dither: 1 },
  { compressionLevel: 9, palette: true, colors: 128, dither: 1 },
];

// fontkitten reaches this repo through Astro's font packages; the orchestrator
// declares it in site devDependencies. Load it here so a missing package reads
// as "could not build", not as a crash.
async function loadFontkit() {
  try {
    return await import("fontkitten");
  } catch {
    return fail(3, "the fontkitten package is not installed; run npm ci at the repo root");
  }
}

function fail(code, msg) {
  console.error(`og: ${msg}`);
  process.exit(code);
}

// Region names, taglines and art keys come from L8's data, so the cards never drift from it.
function loadRegions() {
  const dir = path.join(ROOT, "data/regions");
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const r = YAML.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    out[r.id] = r;
  }
  return out;
}

function loadTokens() {
  const doc = YAML.parse(fs.readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8"));
  return doc.color;
}

// Every cached font fontkitten can read, as { font, file } in FONT_DIRS order,
// then the three faces the card needs (lib.mjs pickFont).
function loadFonts(fontkit) {
  const fonts = [];
  for (const dir of FONT_DIRS.filter((d) => fs.existsSync(d))) {
    for (const f of fs.readdirSync(dir).filter((f) => /\.(woff2?|ttf|otf)$/.test(f)).sort()) {
      const file = path.join(dir, f);
      try {
        fonts.push({ font: fontkit.create(fs.readFileSync(file)), file });
      } catch {
        // Not a font fontkitten can read; skip it.
      }
    }
  }
  const pick = (family, weight) => pickFont(fonts, family, weight);
  const set = { title: pick("Cinzel", 700), body: pick("Alegreya Sans", 500), strong: pick("Alegreya Sans", 700) };
  const missing = Object.entries(set).filter(([, f]) => !f).map(([k]) => k);
  if (missing.length) {
    fail(3, `could not find the ${missing.join(", ")} font(s) in ${FONT_DIRS.map((d) => path.relative(ROOT, d)).join(" or ")}; run \`npm run build\` once so the Astro Fonts API caches them`);
  }
  return set;
}

function findArtFile(key) {
  for (const ext of ["webp", "png", "jpg"]) {
    const file = path.join(ART_DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

async function background(card, c) {
  const own = card.art ? findArtFile(card.art) : null;
  const artKey = own ? card.art : FALLBACK_ART;
  const file = own ?? findArtFile(FALLBACK_ART);
  if (!file) return fail(3, `no art for card "${card.id}" and no ${FALLBACK_ART} art to fall back on`);
  const meta = await sharp(file).metadata();
  if (meta.height > meta.width) {
    // A keeper portrait stands at the right on its own ground color (art/finals.json).
    const place = portraitPlacement(meta.width, meta.height, CARD.width, CARD.height);
    const art = await sharp(file).resize(place.resize).toBuffer();
    const ground = { width: CARD.width, height: CARD.height, channels: 3, background: c.surface };
    return {
      buffer: await sharp({ create: ground }).composite([{ input: art, left: place.left, top: place.top }]).png().toBuffer(),
      source: path.relative(ROOT, file),
      artKey,
      portraitLeft: place.left,
    };
  }
  const crop = coverCrop(meta.width, meta.height, CARD.width, CARD.height, parseFocus(card.focus));
  return { buffer: await sharp(file).resize(crop.resize).extract(crop.extract).toBuffer(), source: path.relative(ROOT, file), artKey };
}

// The text layer as SVG, plus the lines it renders (for the disclosure check)
// and their layout (for the overlap check). `caption` is the AI-agent line for
// a picture with keepers, drawn above the URL.
function overlay(card, c, fonts, portraitLeft, caption) {
  const left = 72;
  const T = CARD_TEXT;
  const titleSpacing = 1.5;
  const titleLines = wrapText(card.title, 640, measure(fonts.title, T.title, titleSpacing), 2);
  const bodyLines = wrapText(card.subtitle, 600, measure(fonts.body, T.body), titleLines.length > 1 ? 2 : 3);
  const at = textLayout(titleLines.length, bodyLines.length, Boolean(caption));

  const title = titleLines.map((line, i) => textPath(fonts.title, line, T.title, left, at.title[i], titleSpacing)).join("");
  const rule = `<rect x="${left}" y="${at.rule}" width="96" height="6" rx="3" fill="${c.accent}"/>`;
  const body = bodyLines.map((line, i) => textPath(fonts.body, line, T.body, left, at.body[i])).join("");
  const url = textPath(fonts.strong, "coloradostartups.org", T.small, left, at.url);
  const note = caption ? textPath(fonts.body, caption, T.small, left, at.caption) : "";

  // The scrim keeps text on near-ground color, so text contrast stays near the
  // token pairs in brand_tokens.yaml (text on ground 15.81:1).
  const scrim = scrimStops(portraitLeft);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}">
  <defs>
    <linearGradient id="s" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${c.ground}" stop-opacity="0.94"/>
      <stop offset="${scrim.solid.toFixed(4)}" stop-color="${c.ground}" stop-opacity="0.94"/>
      <stop offset="${scrim.clear.toFixed(4)}" stop-color="${c.ground}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <title>${xmlEscape(card.title)}</title>
  <rect width="100%" height="100%" fill="url(#s)"/>
  ${textEl(fonts.title, title, T.title, c.text)}
  ${rule}
  ${textEl(fonts.body, body, T.body, c["text-dim"])}
  ${note ? textEl(fonts.body, note, T.small, c["text-dim"]) : ""}
  ${textEl(fonts.strong, url, T.small, c.link)}
</svg>`;
  return { svg, lines: [...titleLines, ...bodyLines, ...(caption ? [caption] : [])], layout: at };
}

async function buildCard(card, c, fonts, logo) {
  const bg = await background(card, c);
  const { svg, lines, layout } = overlay(card, c, fonts, bg.portraitLeft, disclosureCaption(card, bg.artKey));
  const { font } = fonts.body;
  const em = { ascent: font.ascent / font.unitsPerEm, descent: -font.descent / font.unitsPerEm };
  const problem = disclosureProblem(card, lines, bg.artKey) ?? layoutProblem(card.id, layout, em);
  if (problem) fail(1, problem);
  const text = Buffer.from(svg);
  let png;
  let encoding;
  let soften;
  search: for (soften of SOFTEN) {
    const art = soften ? await sharp(bg.buffer).blur(soften).toBuffer() : bg.buffer;
    // Social cards are opaque, and an alpha channel only adds bytes.
    const flat = await sharp(art)
      .composite([
        { input: text, left: 0, top: 0 },
        { input: logo, left: 72, top: 52 },
      ])
      .flatten({ background: c.ground })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (encoding of ENCODINGS) {
      png = await sharp(flat.data, { raw: flat.info }).png(encoding).toBuffer();
      if (png.length <= MAX_BYTES) break search;
    }
  }
  const out = path.join(OUT_DIR, `${card.id}.png`);
  fs.writeFileSync(out, png);
  return {
    id: card.id,
    out: path.relative(ROOT, out),
    bytes: png.length,
    art: bg.source,
    palette: encoding.palette ? encoding.colors : null,
    soften,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  if (onlyIdx !== -1 && !args[onlyIdx + 1]) fail(2, "--only needs a comma-separated list of card ids");
  const only = onlyIdx === -1 ? undefined : new Set(args[onlyIdx + 1].split(","));

  let cards;
  try {
    cards = parseCards(fs.readFileSync(path.join(ROOT, "art/og/cards.txt"), "utf8"), loadRegions());
  } catch (err) {
    fail(3, err.message);
  }
  if (only) {
    const unknown = [...only].filter((id) => !cards.some((c) => c.id === id));
    if (unknown.length) fail(2, `unknown card id(s): ${unknown.join(", ")}`);
    cards = cards.filter((c) => only.has(c.id));
  }
  if (!fs.existsSync(LOGO)) fail(3, `missing ${path.relative(ROOT, LOGO)}`);

  const c = loadTokens();
  const fonts = loadFonts(await loadFontkit());
  const logo = await sharp(LOGO).resize({ height: 128 }).png().toBuffer();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const over = [];
  for (const card of cards) {
    const r = await buildCard(card, c, fonts, logo);
    const kb = Math.round(r.bytes / 1024);
    if (r.bytes > MAX_BYTES) over.push(`${r.id} (${kb} KB)`);
    const notes = [r.palette && `${r.palette}-color palette`, r.soften && `art softened ${r.soften} px`].filter(Boolean);
    console.log(`og: ${r.out} ${kb} KB (art: ${r.art}${notes.length ? `, ${notes.join(", ")}` : ""})`);
  }
  if (over.length) fail(1, `over the ${MAX_BYTES / 1024} KB goal even softened and as a 128-color palette: ${over.join(", ")}`);
}

await main();
