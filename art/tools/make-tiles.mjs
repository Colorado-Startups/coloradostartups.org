#!/usr/bin/env node
// Makes the page-background texture tiles for L12 from Anima renders.
//
//   node art/tools/make-tiles.mjs --from <dir>   read <dir>/tile-<name>.png, write the WebP tiles
//   --pick stone=tile-stone-2                     read <dir>/tile-stone-2.png for the stone tile instead
//   --pick night-stone=<path>.png                 or read any PNG by path (repeat --pick per tile)
//   --out <dir>                                   write somewhere else, to judge candidates
//
// For each tile: luminance -> wrap seam removed by overlap crossfade -> 512 x 512 (with
// as little blur as the size goal allows) ->
// duotone between the contract's floor and ceiling colors -> lossless WebP
// under the size goal. Then it decodes the WebP and checks what it delivers: every pixel
// at or above the floor's luminance and at or below the ceiling's, and the wrap
// edges no rougher than the interior. Exit 0 all tiles pass, 1 a tile fails,
// 2 usage error, 3 an input or token is missing.
//
// TILES restates L12's texture contract (L12's messages of 2026-10-18). Every
// floor and ceiling is a token name, and brand_tokens.yaml is the single source
// of their colors and of the `texture` block. If this table and that block
// disagree, brand_tokens.yaml wins and this table is fixed in the same session;
// site/test/unit/l7/textures.test.ts fails on drift.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "site/src/assets/art/textures");

export const TILES = {
  stone: { source: "tile-stone", floor: "rule", ceiling: "ground", most: "stone", maxBytes: 80 * 1024 },
  parchment: { source: "tile-parchment", floor: "surface-2", ceiling: "surface", maxBytes: 60 * 1024 },
  "night-stone": { source: "tile-night-stone", floor: "night", ceiling: "night-ceiling", maxBytes: 80 * 1024 },
};

export const SIZE = 512;
const CORE = 768; // px of the 1024 px render kept as the tile; the rest is the crossfade overhang
const PAD = 24; // px of wrap padding around the core while resizing, so the kernel sees the wrap
const MOST_SHARE = 0.75; // goal: three quarters of pixels at or above the contract's "most" color

// WCAG relative luminance of an sRGB triple (0 to 255).
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resolveColor(value, colors) {
  if (value.startsWith("#")) return hexToRgb(value);
  if (!colors[value]) throw new Error(`brand_tokens.yaml has no color "${value}"`);
  return hexToRgb(colors[value]);
}

// Removes the wrap seam along one axis: keep `core` pixels and fade the overhang into the
// start. Output pixel core-1 and output pixel 0 are then neighbors in the source.
export function crossfade(src, w, h, core, axis) {
  const outW = axis === "x" ? core : w;
  const outH = axis === "y" ? core : h;
  const k = (axis === "x" ? w : h) - core;
  const out = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = axis === "x" ? x : y;
      const a = src[y * w + x];
      if (i >= k) {
        out[y * outW + x] = a;
      } else {
        const b = axis === "x" ? src[y * w + x + core] : src[(y + core) * w + x];
        const t = i / k;
        out[y * outW + x] = a * t + b * (1 - t);
      }
    }
  }
  return out;
}

// Wrap padding: a tile surrounded by `pad` pixels of itself.
export function wrapPad(src, n, pad) {
  const m = n + pad * 2;
  const out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      out[y * m + x] = src[((y - pad + n) % n) * n + ((x - pad + n) % n)];
    }
  }
  return out;
}

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

// Mean absolute step across the wrap edge, against the mean interior step.
export function seamRatio(gray, n) {
  let edge = 0;
  let inner = 0;
  for (let i = 0; i < n; i++) {
    edge += Math.abs(gray[i * n + (n - 1)] - gray[i * n]) + Math.abs(gray[(n - 1) * n + i] - gray[i]);
    for (const j of [n / 4, n / 2, (3 * n) / 4]) {
      inner += Math.abs(gray[i * n + j] - gray[i * n + j - 1]) + Math.abs(gray[j * n + i] - gray[(j - 1) * n + i]);
    }
  }
  return edge / 2 / (inner / 6);
}

// Luminance of the color at t on the line floor -> ceiling.
function lerpRgb(a, b, t) {
  return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
}

// Finds t where the line floor -> ceiling reaches a target luminance (bisection).
function tForLuminance(floor, ceiling, target) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(lerpRgb(floor, ceiling, mid)) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// From a 1024 x 1024 luminance render to a duotoned 512 x 512 RGB tile with no wrap seam.
export async function makeTile(gray1024, n, spec, colors, { blur = 0, margin = 0 } = {}) {
  const fx = crossfade(gray1024, n, n, CORE, "x");
  const seam = crossfade(fx, CORE, n, CORE, "y");
  const padded = wrapPad(seam, CORE, PAD);
  const pm = CORE + PAD * 2;
  const scale = SIZE / CORE;
  const big = Math.round(pm * scale);
  const crop = Math.round(PAD * scale);
  const bytes = Buffer.from(Float32ToUint8(padded));
  // Resize and blur the padded tile, then crop in JS, so neither step sees a hard edge.
  // The blur radius stays under the crop margin, so the seam survives it.
  const resized = await sharp(bytes, { raw: { width: pm, height: pm, channels: 1 } })
    .resize(big, big, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const small =
    blur > 0
      ? await sharp(resized.data, { raw: { width: big, height: big, channels: resized.info.channels } })
          .blur(blur)
          .raw()
          .toBuffer({ resolveWithObject: true })
      : resized;

  // sharp can hand back three channels for a one-channel input; read the first.
  const stride = small.info.channels;
  const vals = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) vals[y * SIZE + x] = small.data[((y + crop) * big + (x + crop)) * stride] / 255;
  }
  const sorted = Float32Array.from(vals).sort();
  const lo = quantile(sorted, 0.01);
  const hi = quantile(sorted, 0.99);
  const floor = resolveColor(spec.floor, colors);
  const ceiling = resolveColor(spec.ceiling, colors);
  // Gamma so the MOST_SHARE quantile lands on the "most" color, if the contract names one.
  // "most" is a goal, not a contrast floor: without its token, fall back to a straight map.
  let gamma = 1;
  if (spec.most && (spec.most.startsWith("#") || colors[spec.most])) {
    const tMost = tForLuminance(floor, ceiling, luminance(resolveColor(spec.most, colors)));
    const q = Math.min(Math.max((quantile(sorted, 1 - MOST_SHARE) - lo) / (hi - lo), 1e-3), 0.999);
    gamma = Math.log(tMost) / Math.log(q);
  }
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let p = 0; p < vals.length; p++) {
    const t0 = Math.min(Math.max((vals[p] - lo) / (hi - lo), 0), 1) ** gamma;
    // Lossless WebP keeps these exact, so the default margin is 0; checkTile verifies the file.
    const t = margin + t0 * (1 - 2 * margin);
    const c = lerpRgb(floor, ceiling, t);
    rgb[p * 3] = Math.round(c[0]);
    rgb[p * 3 + 1] = Math.round(c[1]);
    rgb[p * 3 + 2] = Math.round(c[2]);
  }
  return { rgb, gamma };
}

function Float32ToUint8(f) {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(f[i])));
  return out;
}

// Decodes a delivered tile and checks it against its contract.
export async function checkTile(file, spec, colors) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const floorY = luminance(resolveColor(spec.floor, colors));
  const ceilY = luminance(resolveColor(spec.ceiling, colors));
  let minY = Infinity;
  let maxY = -Infinity;
  let most = 0;
  const hasMost = Boolean(spec.most && (spec.most.startsWith("#") || colors[spec.most]));
  const mostY = hasMost ? luminance(resolveColor(spec.most, colors)) : -Infinity;
  const gray = new Float32Array(info.width * info.height);
  for (let p = 0; p < gray.length; p++) {
    const y = luminance([data[p * 3], data[p * 3 + 1], data[p * 3 + 2]]);
    gray[p] = y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (y >= mostY) most++;
  }
  const bytes = fs.statSync(file).size;
  const problems = [];
  if (info.width !== SIZE || info.height !== SIZE) problems.push(`size ${info.width} x ${info.height}, not ${SIZE} x ${SIZE}`);
  if (minY < floorY) problems.push(`darkest pixel is darker than the floor (${spec.floor})`);
  if (maxY > ceilY) problems.push(`lightest pixel is lighter than the ceiling (${spec.ceiling})`);
  if (bytes > spec.maxBytes) problems.push(`${Math.round(bytes / 1024)} KB, over the ${spec.maxBytes / 1024} KB goal`);
  const seam = seamRatio(gray, info.width);
  if (seam > 1.5) problems.push(`wrap edge is ${seam.toFixed(2)}x rougher than the interior`);
  return { problems, bytes, seam, mostShare: hasMost ? most / gray.length : null };
}

export const BLURS = [0, 0.7, 1.2, 1.8]; // px sigma, tried in order until a tile fits its size goal

// Lossless WebP only: lossy WebP's chroma subsampling moves colors by a few
// levels, which escapes a band as narrow as night's. The size budget buys
// smoothness instead: each step blurs a little more, which a quiet background
// wants anyway, and checkTile judges every attempt.
export async function encodeTile(gray1024, n, out, spec, colors) {
  let result;
  for (const blur of BLURS) {
    const { rgb, gamma } = await makeTile(gray1024, n, spec, colors, { blur });
    await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(out);
    result = { ...(await checkTile(out, spec, colors)), blur, gamma };
    if (!result.problems.some((p) => p.includes("KB"))) break;
  }
  return result;
}

// The value after a --flag: undefined when the flag is absent. Throws when the
// flag has no value or the next word is another flag, so "--out --pick ..."
// is a usage error, not a folder named --pick.
export function optionValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value === "" || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

// --pick <tile>=<value>, repeatable. A value ending in .png is a path; anything
// else is a render id in the --from folder.
export function parsePicks(args) {
  const picks = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--pick") continue;
    const m = /^([a-z-]+)=(.+)$/.exec(args[i + 1] ?? "");
    if (!m || !TILES[m[1]]) throw new Error(`--pick takes <tile>=<id or .png path> with a tile of ${Object.keys(TILES).join(", ")}`);
    picks[m[1]] = m[2];
  }
  return picks;
}

export function sourceFile(from, value) {
  return value.endsWith(".png") ? path.resolve(value) : path.join(from, `${value}.png`);
}

// One render PNG to one delivered tile; make-finals.mjs calls this too.
export async function tileFromPng(src, out, spec, colors) {
  const { data, info } = await sharp(src).resize(1024, 1024, { fit: "cover" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const gray = Float32Array.from(data.subarray(0, info.width * info.height));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return encodeTile(gray, 1024, out, spec, colors);
}

export function describeTile(result, out, spec) {
  return (
    `${result.problems.length ? "FAIL" : "ok"} ${path.relative(ROOT, out)} ${Math.round(result.bytes / 1024)} KB, blur ${result.blur}, seam ${result.seam.toFixed(2)}, gamma ${result.gamma.toFixed(2)}` +
    (result.mostShare === null ? (spec.most ? `, "${spec.most}" token not on this branch, so no gamma` : "") : `, ${(result.mostShare * 100).toFixed(0)}% at or above ${spec.most}`) +
    (result.problems.length ? `: ${result.problems.join("; ")}` : "")
  );
}

export function loadColors() {
  return YAML.parse(fs.readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8")).color;
}

async function main() {
  const args = process.argv.slice(2);
  const usage = "usage: node art/tools/make-tiles.mjs --from <dir with tile-*.png> [--pick <tile>=<id or .png path>]... [--out <dir>]";
  let fromArg;
  let outArg;
  let picks;
  try {
    fromArg = optionValue(args, "--from");
    outArg = optionValue(args, "--out");
    picks = parsePicks(args);
  } catch (err) {
    console.error(`make-tiles: ${err.message}\n${usage}`);
    process.exit(2);
  }
  if (!fromArg) {
    console.error(usage);
    process.exit(2);
  }
  const from = path.resolve(fromArg);
  const outDir = outArg === undefined ? OUT_DIR : path.resolve(outArg);
  let colors;
  try {
    colors = loadColors();
  } catch (err) {
    console.error(`make-tiles: could not read brand_tokens.yaml: ${err.message}`);
    process.exit(3);
  }
  // A token this table names but brand_tokens.yaml lacks is an infrastructure
  // gap (for example L12's night-ceiling before its PR lands), not a bad tile.
  const missing = [...new Set(Object.values(TILES).flatMap((s) => [s.floor, s.ceiling]))].filter((v) => !v.startsWith("#") && !colors[v]);
  if (missing.length) {
    console.error(`make-tiles: brand_tokens.yaml has no ${missing.join(", ")} color yet; merge the tokens first`);
    process.exit(3);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const [name, spec] of Object.entries(TILES)) {
    const src = sourceFile(from, picks[name] ?? spec.source);
    if (!fs.existsSync(src)) {
      console.error(`make-tiles: missing ${src}`);
      process.exit(3);
    }
    const out = path.join(outDir, `${name}.webp`);
    const result = await tileFromPng(src, out, spec, colors);
    if (result.problems.length) failed++;
    console.log(`make-tiles: ${describeTile(result, out, spec)}`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
