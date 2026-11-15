#!/usr/bin/env node
// Builds the 1200 x 630 Open Graph cards in site/public/og/ in brand v3's card
// composition: the art covers the card, a State-red rule sits near the top left,
// and the card's name sits under it in white Aileron. Nothing else: brand cards
// show only their name (brand decision 46). A card whose art shows a keeper adds
// its AI-agent caption under the name (.claude/rules/ai-disclosure.md).
//
//   node scripts/og/build.mjs                  every card in art/og/cards.txt
//   node scripts/og/build.mjs --only home,team  some cards
//
// Runs in site's prebuild (CI and Workers Builds), so the cards are never
// rendered on a laptop and never committed (site/public/og/ is gitignored).
//
// Inputs:
//   art/og/cards.txt                 card names and art (in art/ so the content gate scans it)
//   data/regions/<id>.yaml           name and art for the region cards (L8's data)
//   site/public/art/brand/<name>.jpg brand/<name> art, pulled by scripts/brand/pull.mjs
//   site/src/assets/art/<key>.*      other art; falls back to brand/golden, and exits 3 without it.
//                                    Wide art covers the card; a portrait stands whole at the right
//   @fontsource/aileron              Aileron Regular, the brand's display face (brand tokens/type.yaml, CC0)
//
// Text is set as vector paths from the font file, so the cards never depend on
// the fonts installed on the machine. Cards are JPEG, since the art is painted,
// and carry their art's XMP, so the AI-made label survives (brand decision 46).
// BaseLayout.astro links /og/<id>.jpg.
// Exit codes: 0 built, 1 a card is over the size goal or a keeper card's text
// lost its AI-agent disclosure, 2 usage error, 3 could not build (a font,
// package or input is missing).
import fs from "node:fs";
import { createRequire } from "node:module";
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
  measure,
  parseCards,
  parseFocus,
  portraitPlacement,
  textEl,
  textLayout,
  textPath,
  wrapText,
  xmlEscape,
} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AILERON_FILE = "@fontsource/aileron/files/aileron-latin-400-normal.woff2";
// Brand v3 colors (brand research/color/state.yaml, decision 29): the State
// palette's Red for the rule and Blue as a portrait card's ground. Replace with
// the v3 tokens when brand Wave 2 (S12) ships them.
const BRAND = { red: "#C3002F", blue: "#001970", white: "#FFFFFF" };
const ART_DIR = path.join(ROOT, "site/src/assets/art");
const OUT_DIR = path.join(ROOT, "site/public/og");
const FALLBACK_ART = "brand/golden";
const MAX_BYTES = 300 * 1024; // goal per card (orchestrator review of PR #2)

// The first quality that fits MAX_BYTES wins. PNG ran 350 to 410 KB on the
// brand paintings even blurred and palettized (PR #31's first CI run).
const QUALITIES = [82, 74, 66];

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

// Region names and art keys come from L8's data, so the cards never drift from it.
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

// Aileron Regular from @fontsource/aileron, as { font }, the shape lib.mjs's
// measure and textPath take.
function loadAileron(fontkit) {
  let file;
  try {
    file = createRequire(import.meta.url).resolve(AILERON_FILE);
  } catch {
    return fail(3, `missing ${AILERON_FILE}; run npm ci at the repo root`);
  }
  return { font: fontkit.create(fs.readFileSync(file)), embolden: 0 };
}

function findArtFile(key) {
  // Brand v3 art (brand/<name>) is pulled by scripts/brand/pull.mjs; draw on the original.
  if (key.startsWith("brand/")) {
    const file = path.join(ROOT, "site/public/art/brand", `${key.slice("brand/".length)}.jpg`);
    return fs.existsSync(file) ? file : undefined;
  }
  for (const ext of ["webp", "png", "jpg"]) {
    const file = path.join(ART_DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

async function background(card) {
  const own = card.art ? findArtFile(card.art) : null;
  const artKey = own ? card.art : FALLBACK_ART;
  const file = own ?? findArtFile(FALLBACK_ART);
  if (!file) return fail(3, `no art for card "${card.id}" and no ${FALLBACK_ART} art to fall back on`);
  const meta = await sharp(file).metadata();
  const xmp = meta.xmp ? meta.xmp.toString("utf8") : null;
  if (meta.height > meta.width) {
    // A keeper portrait stands at the right on its own ground color (art/finals.json).
    const place = portraitPlacement(meta.width, meta.height, CARD.width, CARD.height);
    const art = await sharp(file).resize(place.resize).toBuffer();
    const ground = { width: CARD.width, height: CARD.height, channels: 3, background: BRAND.blue };
    return {
      buffer: await sharp({ create: ground }).composite([{ input: art, left: place.left, top: place.top }]).png().toBuffer(),
      source: path.relative(ROOT, file),
      artKey,
      xmp,
      portraitLeft: place.left,
    };
  }
  const crop = coverCrop(meta.width, meta.height, CARD.width, CARD.height, parseFocus(card.focus));
  return { buffer: await sharp(file).resize(crop.resize).extract(crop.extract).toBuffer(), source: path.relative(ROOT, file), artKey, xmp };
}

// The text layer as SVG, plus the lines it renders (for the disclosure check).
// `caption` is the AI-agent line for a picture with keepers. A soft dark fade
// from the top left keeps the white name readable on any wide art; a portrait
// card's ground is already the State Blue, so it needs none.
function overlay(card, font, portraitLeft, caption) {
  const left = 72;
  const T = CARD_TEXT;
  const maxWidth = (portraitLeft ?? CARD.width) - left - 48;
  const titleLines = wrapText(card.title, maxWidth, measure(font, T.title), 2);
  const at = textLayout(titleLines.length, Boolean(caption));
  const title = titleLines.map((line, i) => textPath(font, line, T.title, left, at.title[i])).join("");
  const note = caption ? textPath(font, caption, T.small, left, at.caption) : "";
  // The fade is an ellipse centered on the text block, so every glyph sits on at
  // least about 50% shade. Centered at the corner, it left the name on 17% shade
  // and white on bright sky (PR #31's first renders, Founders and Space Peak).
  const fade =
    portraitLeft == null
      ? `<defs><radialGradient id="f" cx="0" cy="0" r="1" gradientTransform="translate(330 180) scale(720 360)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity="0.65"/><stop offset="0.5" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient></defs><rect width="100%" height="100%" fill="url(#f)"/>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}">
  <title>${xmlEscape(card.title)}</title>
  ${fade}
  <rect x="${left}" y="${at.rule}" width="120" height="6" fill="${BRAND.red}"/>
  ${textEl(font, title, T.title, BRAND.white)}
  ${note ? textEl(font, note, T.small, BRAND.white) : ""}
</svg>`;
  return { svg, lines: [...titleLines, ...(caption ? [caption] : [])] };
}

async function buildCard(card, font) {
  const bg = await background(card);
  const { svg, lines } = overlay(card, font, bg.portraitLeft, disclosureCaption(card, bg.artKey));
  const problem = disclosureProblem(card, lines, bg.artKey);
  if (problem) fail(1, problem);
  const flat = await sharp(bg.buffer)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .flatten({ background: BRAND.blue })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let jpg;
  let quality;
  for (quality of QUALITIES) {
    const enc = sharp(flat.data, { raw: flat.info }).jpeg({ quality, mozjpeg: true });
    jpg = await (bg.xmp ? enc.withXmp(bg.xmp) : enc).toBuffer();
    if (jpg.length <= MAX_BYTES) break;
  }
  const out = path.join(OUT_DIR, `${card.id}.jpg`);
  fs.writeFileSync(out, jpg);
  return { id: card.id, out: path.relative(ROOT, out), bytes: jpg.length, art: bg.source, quality, xmp: Boolean(bg.xmp) };
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
  const font = loadAileron(await loadFontkit());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const over = [];
  for (const card of cards) {
    const r = await buildCard(card, font);
    const kb = Math.round(r.bytes / 1024);
    if (r.bytes > MAX_BYTES) over.push(`${r.id} (${kb} KB)`);
    console.log(`og: ${r.out} ${kb} KB (art: ${r.art}, quality ${r.quality}${r.xmp ? ", XMP kept" : ""})`);
  }
  if (over.length) fail(1, `over the ${MAX_BYTES / 1024} KB goal even at quality ${QUALITIES.at(-1)}: ${over.join(", ")}`);
}

await main();
