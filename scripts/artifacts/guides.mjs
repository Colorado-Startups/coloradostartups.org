// The two hand-written guides (inline-page.mjs): their <!-- l16:... --> markers
// filled from the repo, and their local images inlined. The palette and
// contrast tiles come from 01_doctrine/brand_tokens.yaml, and the brand guide's
// vocabulary from art/DIRECTION.md, so they cannot drift.

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

import { artStatusHtml, countArt, dataUri, isInside, OUT, ROOT, safeInline, siteCommit, textureNoteHtml, texturesCss, writtenCommit } from "./shared.mjs";

const TOKENS = path.join(ROOT, "01_doctrine/brand_tokens.yaml");

// The style guide's groups. A token missing here lands in "Other", so a new
// color still shows up on the brand page instead of vanishing.
const PALETTE_GROUPS = [
  ["Daylight and stone", ["ground", "surface", "surface-2", "stone", "stone-edge", "rule", "border"]],
  ["Ink", ["text", "text-dim", "link", "community", "danger", "focus", "on-accent", "on-bronze"]],
  ["Forge metals", ["accent", "accent-deep", "accent-ledge", "molten", "brass", "bronze", "bronze-deep", "fire"]],
  ["Night", ["night", "on-night", "on-night-dim", "gold-on-night", "focus-on-night", "danger-on-night", "night-ceiling"]],
  ["Tag washes", ["sky-wash", "copper-wash", "pine", "pine-wash"]],
  ["Brand marks, logo only", ["brand-teal", "brand-purple"]],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function readTokens() {
  const { parseDocument } = await import("yaml");
  const doc = parseDocument(readFileSync(TOKENS, "utf8"));
  const roles = {};
  for (const pair of doc.get("color", true).items) roles[pair.key.value] = (pair.value.comment || "").trim();
  const data = doc.toJS();
  return { color: data.color, roles, contrast: data.contrast };
}

function paletteHtml({ color, roles }) {
  const placed = new Set(PALETTE_GROUPS.flatMap(([, names]) => names));
  const groups = [...PALETTE_GROUPS, ["Other", Object.keys(color).filter((n) => !placed.has(n))]];
  return groups
    .filter(([, names]) => names.some((n) => color[n]))
    .map(([label, names]) => {
      const chips = names
        .filter((n) => color[n])
        .map(
          (n) => `<li class="swatch"><span class="swatch__chip" style="background:${esc(color[n])}"></span>` +
            `<code class="swatch__name">--c-${esc(n)}</code><span class="swatch__hex">${esc(color[n])}</span>` +
            `<span class="swatch__role">${esc(roles[n] || "")}</span></li>`,
        )
        .join("");
      return `<h3 class="palette__group">${esc(label)}</h3><ul class="swatches">${chips}</ul>`;
    })
    .join("\n");
}

// Whether a pairing sits close enough to its WCAG floor that the guide flags
// it, so a reader sees which hex values have the least room to move. A fixed
// margin, not a percentage: 20% above the 3:1 UI floor is 3.6, which would
// miss border on stone at 3.62, the tightest UI pairing.
const CLOSE_MARGIN = 0.75;
function nearMinimum(ratio, min) {
  return ratio - min < CLOSE_MARGIN;
}

function contrastHtml({ color, contrast }) {
  return contrast
    .map(({ fg, bg, ratio, min }) => {
      const ui = min < 4.5;
      const close = Boolean(nearMinimum(Number(ratio), Number(min)));
      const sample = ui
        ? `<span class="pair__ring" style="border-color:${esc(color[fg])}"></span>`
        : `<span class="pair__aa" style="color:${esc(color[fg])}">Aa</span>`;
      return `<li class="pair${close ? " pair--close" : ""}"><span class="pair__sample" style="background:${esc(color[bg])}">${sample}</span>` +
        `<span class="pair__label">${esc(fg)} on ${esc(bg)}</span>` +
        `<span class="pair__ratio">${Number(ratio).toFixed(2)}:1 <small>needs ${min}:1${ui ? ", UI part" : ""}</small>` +
        `${close ? '<em class="pair__close">Close to its floor</em>' : ""}</span></li>`;
    })
    .join("");
}

// art/DIRECTION.md is the one source for the Hall's vocabulary, so the brand
// guide renders it from that file each run.
const DIRECTION = path.join(ROOT, "art/DIRECTION.md");

// The body of one "## " section, up to the next "## " heading, or null when
// the heading is gone. A heading matches by prefix: "Models" finds
// "## Models (decision 88)".
function mdSection(md, heading) {
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

// Escape first, then turn `code` and **bold** into tags. These sections use no
// other Markdown.
const mdInline = (text) =>
  esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

// The section's first table as a <thead> and <tbody>, for a <table> that keeps
// its own <caption> in the guide; null when the section has no table rows.
function mdTableHtml(section) {
  const lines = section.split("\n");
  const first = lines.findIndex((line) => line.startsWith("|"));
  const rows = [];
  for (const line of first === -1 ? [] : lines.slice(first)) {
    if (!line.startsWith("|")) break;
    rows.push(line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  }
  const [head = [], , ...body] = rows;
  if (!head.length || !body.length) return null;
  const th = head.map((cell) => `<th scope="col">${mdInline(cell)}</th>`).join("");
  const tr = body.map((row) => `<tr>${row.map((cell) => `<td>${mdInline(cell)}</td>`).join("")}</tr>`);
  return `<thead><tr>${th}</tr></thead><tbody>${tr.join("\n")}</tbody>`;
}

// A guide is published, so it may inline only the site's own published
// images: a file under site/public or site/src/assets, with an image
// extension, and no dotfile or dot folder anywhere on its path. Anything
// else (site/.dev.vars, a JSON file, a secret) is refused, and the run exits 1.
const DOC_IMAGE_DIRS = ["site/public", "site/src/assets"];
const DOC_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"]);

function docImageFile(ref, baseDir, root = ROOT) {
  let clean;
  try {
    clean = decodeURIComponent(ref.split(/[?#]/)[0]);
  } catch {
    return { file: null, reason: "unreadable path" };
  }
  const file = path.resolve(baseDir, clean);
  const allowed = DOC_IMAGE_DIRS.map((d) => path.join(root, d)).find((dir) => isInside(file, dir));
  if (!allowed) return { file: null, reason: "outside site/public and site/src/assets" };
  if (path.relative(allowed, file).split(path.sep).some((part) => part.startsWith("."))) {
    return { file: null, reason: "a dotfile" };
  }
  if (!DOC_IMAGE_EXT.has(path.extname(file).toLowerCase())) return { file: null, reason: "not an image" };
  if (!existsSync(file) || !statSync(file).isFile()) return { file: null, reason: "missing" };
  return { file, reason: null };
}

function inlineDocImages(html, baseDir, notes) {
  return html.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/g, (match, pre, ref, post) => {
    if (/^(data:|https?:)/.test(ref)) return match;
    const { file, reason } = docImageFile(ref, baseDir);
    if (!file) {
      notes.rejected.add(`${ref} (${reason})`);
      return `${pre}${post}`;
    }
    return `${pre}${dataUri(file)}${post}`;
  });
}

async function buildDoc(entry, tokens, manifest) {
  const srcFile = path.join(ROOT, entry.file);
  const notes = { unresolved: new Set(), rejected: new Set() };
  const urls = Object.fromEntries([...manifest.pages, ...manifest.docs].map((e) => [`url-${e.slug}`, () => esc(e.url || "#")]));
  // Read the tiles once per guide. A refused tile is reported, which makes the run exit 1.
  let tex;
  const textures = () => {
    if (tex === undefined) {
      try {
        tex = texturesCss();
      } catch (error) {
        notes.rejected.add(`texture tiles (${error.message})`);
        tex = "";
      }
    }
    return tex;
  };
  // A section the guide needs but DIRECTION.md no longer has, or one left with
  // no table, is refused, which makes the run exit 1, like a refused tile.
  let direction;
  const fromDirection = (heading, render) => () => {
    direction ??= readFileSync(DIRECTION, "utf8");
    const section = mdSection(direction, heading);
    if (section === null) {
      notes.rejected.add(`art/DIRECTION.md section "${heading}" (missing)`);
      return "";
    }
    const html = render(section);
    if (html === null) {
      notes.rejected.add(`art/DIRECTION.md section "${heading}" (no table)`);
      return "";
    }
    return html;
  };
  const fill = {
    ...urls,
    palette: () => paletteHtml(tokens),
    contrast: () => contrastHtml(tokens),
    "contrast-count": () => String(tokens.contrast.length),
    "color-count": () => String(Object.keys(tokens.color).length),
    // The guides restate the whole repo, so they carry the same stamp as the pages.
    built: () => esc(siteCommit()),
    // Hand-written facts carry the commit that last changed the guide instead.
    written: () => esc(writtenCommit(entry.file)),
    "art-status": () => artStatusHtml(countArt()),
    "textures-css": () => safeInline(textures(), "style"),
    "texture-note": () => textureNoteHtml(textures()),
    vocabulary: fromDirection("The vocabulary of the Hall", mdTableHtml),
    // The site's own generated tokens and L12's primitives, so the guide's
    // specimens are the real classes rather than look-alikes.
    "tokens-css": () => safeInline(readFileSync(path.join(ROOT, "site/src/styles/tokens.css"), "utf8"), "style"),
    "hall-css": () => safeInline(readFileSync(path.join(ROOT, "site/src/styles/hall.css"), "utf8"), "style"),
  };
  let html = readFileSync(srcFile, "utf8").replace(/<!-- l16:([a-z0-9-]+) -->/g, (match, key) => {
    if (fill[key]) return fill[key]();
    notes.unresolved.add(match);
    return match;
  });
  html = inlineDocImages(html, path.dirname(srcFile), notes);
  const outFile = path.join(OUT, `${entry.slug}.html`);
  writeFileSync(outFile, html);
  return { outFile, bytes: Buffer.byteLength(html), notes };
}

export { buildDoc, contrastHtml, docImageFile, mdSection, mdTableHtml, nearMinimum, paletteHtml, readTokens };
