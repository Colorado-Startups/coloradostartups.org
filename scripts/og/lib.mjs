// Pure helpers for the OG card generator (scripts/og/build.mjs), and the font
// and text-path helpers it shares with the badge kit
// (site/src/components/kit/build-badges.mjs). No file or network access here,
// so site/test/unit/l7/og.test.ts can test them directly.

import path from "node:path";

export const CARD = { width: 1200, height: 630 };

// Parses art/og/cards.txt: blocks of `key: value` lines separated by blank lines.
// Every card needs an id. A card with `region: <id>` takes its title and
// subtitle from data/regions/<id>.yaml (L8's data, through `regions`); every
// other card needs its own title and subtitle. art is optional.
export function parseCards(text, regions = {}) {
  const cards = [];
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const block of blocks) {
    const card = {};
    for (const line of block.split("\n")) {
      const m = line.match(/^([a-z]+):\s*(.*)$/);
      if (!m) throw new Error(`cards.txt: not a "key: value" line: ${line}`);
      card[m[1]] = m[2].trim();
    }
    if (card.region) {
      const r = regions[card.region];
      if (!r) throw new Error(`cards.txt: card "${card.id}" names region "${card.region}", which has no data/regions file`);
      card.title ??= r.name;
      card.subtitle ??= r.tagline;
      card.art ??= r.art;
    }
    for (const key of ["id", "title", "subtitle"]) {
      if (!card[key]) throw new Error(`cards.txt: a card is missing "${key}" (${JSON.stringify(card)})`);
    }
    if (!/^[a-z0-9-]+$/.test(card.id)) throw new Error(`cards.txt: id "${card.id}" must be lowercase words and hyphens`);
    if (cards.some((c) => c.id === card.id)) throw new Error(`cards.txt: duplicate id "${card.id}"`);
    cards.push(card);
  }
  return cards;
}

// Greedy word wrap. `measure(text)` returns a width in px.
// Returns at most `maxLines` lines; the last line ends with an ellipsis if text was cut.
export function wrapText(text, maxWidth, measure, maxLines = Infinity) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next) <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.includes(" ") && measure(`${last}…`) > maxWidth) last = last.replace(/\s+\S+$/, "");
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

// Where to cut a cover crop from a source of size (sw, sh) into (tw, th),
// centered on a focal point given as fractions (0 to 1). Returns the resize
// size and the extract box, in the same shape sharp takes.
export function coverCrop(sw, sh, tw, th, focus = { x: 0.5, y: 0.5 }) {
  const scale = Math.max(tw / sw, th / sh);
  const rw = Math.round(sw * scale);
  const rh = Math.round(sh * scale);
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  const left = clamp(Math.round(rw * focus.x - tw / 2), rw - tw);
  const top = clamp(Math.round(rh * focus.y - th / 2), rh - th);
  return { resize: { width: rw, height: rh }, extract: { left, top, width: tw, height: th } };
}

// Where a portrait (art taller than wide, such as a keeper) sits on the card:
// the whole picture at full card height, flush right, clear of the text scrim.
// Cover-cropping a portrait would cut a band through its middle and leave the
// face under the scrim.
export function portraitPlacement(sw, sh, tw, th) {
  const width = Math.round((sw * th) / sh);
  return { resize: { width, height: th }, left: tw - width, top: 0 };
}

// Where the text scrim is solid and where it has faded out, as fractions of
// the card width. A wide-art card fades across the middle of the picture. A
// portrait card keeps the scrim off the portrait: solid to just short of its
// left edge, clear at the edge, so the keeper is never washed out.
export function scrimStops(portraitLeft, width = CARD.width) {
  if (portraitLeft == null) return { solid: 0.55, clear: 0.82 };
  return { solid: (portraitLeft - 24) / width, clear: portraitLeft / width };
}

// Type sizes and line pitches on the card, in px.
export const CARD_TEXT = { title: 68, titlePitch: 78, body: 30, bodyPitch: 40, small: 24 };

// The text column's baselines, in px. The title, accent rule and body flow
// down from below the logo; the caption (null without one) and the URL hold
// fixed slots above the bottom edge, so layoutProblem checks the body clears them.
export function textLayout(titleCount, bodyCount, hasCaption) {
  const top = 236 + Math.round(CARD_TEXT.title * 0.72);
  const title = Array.from({ length: titleCount }, (_, i) => top + i * CARD_TEXT.titlePitch);
  const rule = top + (titleCount - 1) * CARD_TEXT.titlePitch + 30;
  const body = Array.from({ length: bodyCount }, (_, i) => rule + 6 + 50 + i * CARD_TEXT.bodyPitch);
  return { title, rule, body, caption: hasCaption ? CARD.height - 100 : null, url: CARD.height - 56 };
}

// A line's box runs from its font's ascent above the baseline to its descent
// below, in em (Alegreya Sans: 0.9 and 0.3). The body's own lines sit 4 px
// apart, so under 8 px between the body, caption and URL reads as touching.
const MIN_GAP = 8;

// A problem when the body's last line, the caption and the URL come within
// MIN_GAP px of each other in a textLayout; null when they clear.
export function layoutProblem(id, layout, em = { ascent: 0.9, descent: 0.3 }) {
  const lines = [
    { name: "subtitle", baseline: layout.body.at(-1), size: CARD_TEXT.body },
    layout.caption != null && { name: "caption", baseline: layout.caption, size: CARD_TEXT.small },
    { name: "URL", baseline: layout.url, size: CARD_TEXT.small },
  ].filter(Boolean);
  for (let i = 1; i < lines.length; i += 1) {
    const [above, below] = [lines[i - 1], lines[i]];
    const gap = below.baseline - em.ascent * below.size - (above.baseline + em.descent * above.size);
    if (gap < MIN_GAP) {
      return `card "${id}": its ${above.name} runs into its ${below.name} (${gap.toFixed(1)} px apart, ${MIN_GAP} needed); shorten the title or subtitle`;
    }
  }
  return null;
}

// Every keeper is disclosed as an AI agent wherever its picture appears (BRIEF,
// hard constraint 10). A card whose art shows a keeper must carry these words
// in the text it renders.
export const DISCLOSURE = "AI agent";

// Scenes that show keepers among the founders: the Great Hall has dwarf and
// gnome keepers carrying lanterns (HALL_ART_ALT, #707; art/prompts/hero-a.txt).
// It is also the no-art fallback (build.mjs), so a fallback card discloses too (#744).
// Each region scene has dwarf and gnome helpers at the founders' benches
// (art/prompts/region-*.txt), so the region cards disclose too (#761).
const KEEPER_SCENES = new Set(["hero/hall", "regions/photon-mountain", "regions/space-peak", "regions/fusion-canyon"]);

// True for art that shows a keeper: a keeper portrait, or a scene with keepers in it.
export function isKeeperArt(art) {
  return /^agents\//.test(String(art ?? "")) || KEEPER_SCENES.has(String(art ?? ""));
}

// The line build.mjs adds under a card whose picture shows keepers when the
// card's own words do not say so.
export const DISCLOSURE_CAPTION = "The keepers in the picture are AI agents.";

// The caption a card needs for the art it is drawn on (after any fallback), or
// null when the art shows no keeper or the title and subtitle already disclose.
export function disclosureCaption(card, art = card.art) {
  if (!isKeeperArt(art)) return null;
  return `${card.title} ${card.subtitle}`.includes(DISCLOSURE) ? null : DISCLOSURE_CAPTION;
}

// `lines` is what the card renders (title, subtitle and any caption, after
// wrapping); `art` is the picture it is drawn on, after any fallback. Returns
// a problem when a keeper card's lines lack the disclosure, or when wrapping
// cut the text short (wrapText ends a cut line with an ellipsis), since a
// trimmed disclosure is no disclosure. Null otherwise.
export function disclosureProblem(card, lines, art = card.art) {
  if (!isKeeperArt(art)) return null;
  const text = lines.join(" ");
  if (!text.includes(DISCLOSURE)) return `card "${card.id}" shows keepers (${art}) but its rendered text does not say "${DISCLOSURE}"`;
  if (text.includes("…")) return `card "${card.id}" shows keepers (${art}) and its text is cut short; shorten the subtitle`;
  return null;
}

// "50% 40%" -> { x: 0.5, y: 0.4 }. Anything else -> center.
export function parseFocus(value) {
  const m = String(value ?? "").match(/^\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/);
  if (!m) return { x: 0.5, y: 0.5 };
  return { x: Math.min(Number(m[1]), 100) / 100, y: Math.min(Number(m[2]), 100) / 100 };
}

// Escapes text for an SVG attribute or text node.
export function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

// ---- Fonts and text as SVG paths (OG cards and badges) ----

// Static weights can carry the weight in the legacy family name ("Alegreya Sans Medium").
const ofFamily = (font, family) => font.familyName === family || font.familyName.startsWith(`${family} `);

/**
 * The face for one family and weight from candidates ({ font, file }) in folder
 * order. Each folder is searched in full, an exact weight and then a variable
 * font, before the next: a static weight left in the cache must not beat the
 * variable font the build ships (#380). Returns the candidate with embolden, a
 * stroke width in em that fakes extra weight: Cinzel arrives as one variable
 * WOFF2 that fontkitten 1.0.3 cannot instance, so a variable font is used at
 * its default weight with a same-color stroke, about 0.04 em from 400 to 700.
 */
export function pickFont(candidates, family, weight) {
  for (const dir of new Set(candidates.map((c) => path.dirname(c.file)))) {
    const here = candidates.filter((c) => path.dirname(c.file) === dir && ofFamily(c.font, family));
    const exact = here.find(
      (c) => c.font["OS/2"]?.usWeightClass === weight && !/italic/i.test(`${c.font.familyName} ${c.font.subfamilyName}`),
    );
    if (exact) return { ...exact, embolden: 0 };
    const variable = here.find((c) => c.font.variationAxes?.wght);
    if (variable) {
      const base = variable.font.variationAxes.wght.default;
      return { ...variable, embolden: Math.max(0, ((weight - base) / 300) * 0.04) };
    }
  }
  return undefined;
}

/** A line's width at one face and size, letter spacing between glyphs included. */
export function measure({ font, embolden }, size, spacing = 0) {
  const s = size / font.unitsPerEm;
  const extra = embolden * size;
  return (text) => {
    const glyphs = font.glyphsForString(text);
    return glyphs.reduce((w, g) => w + g.advanceWidth * s + extra, 0) + spacing * Math.max(glyphs.length - 1, 0);
  };
}

/** One line of text as SVG path data, pen starting at (x, baseline). */
export function textPath({ font, embolden }, text, size, x, baseline, spacing = 0) {
  const s = size / font.unitsPerEm;
  const extra = embolden * size;
  let pen = x + extra / 2;
  let d = "";
  for (const glyph of font.glyphsForString(text)) {
    d += glyph.path.scale(s, -s).translate(pen, baseline).toSVG();
    pen += glyph.advanceWidth * s + extra + spacing;
  }
  return d;
}

/** A <path> for text path data; a synthetic-bold face gets a same-color stroke, its width written by `fmt`. */
export function textEl(face, d, size, fill, fmt = (n) => n.toFixed(2)) {
  const stroke = face.embolden ? ` stroke="${fill}" stroke-width="${fmt(face.embolden * size)}" stroke-linejoin="round"` : "";
  return `<path d="${d}" fill="${fill}"${stroke}/>`;
}
