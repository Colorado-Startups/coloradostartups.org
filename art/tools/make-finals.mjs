#!/usr/bin/env node
// Turns picked renders into the WebP files the site ships.
//
//   node art/tools/make-finals.mjs --from <inbox>              write every file in art/finals.json, tiles too
//   node art/tools/make-finals.mjs --from <inbox> --previews 1 also write art/concepts/batch-1/*.webp
//   node art/tools/make-finals.mjs --from <inbox> --batch 3    write only the files batch 3 ships
//   node art/tools/make-finals.mjs --stamp                     rewrite only the provenance XMP of the shipped files
//
// <inbox> holds batch-<n>/<id>.png, as the Modal runner writes it. For each entry
// in art/finals.json: keeper ground -> crop -> resize -> WebP -> provenance XMP
// (provenance.mjs: model, version, license, prompt and seed). Then it decodes
// each file and checks what it delivers: the size its kind asks for, its own
// XMP record, and no EXIF, ICC or ComfyUI prompt graph (ComfyUI writes the
// whole graph into its PNGs; none of that ships). For keeper avatars it also
// measures, at 64 px inside the site's circle, how much of each keeper's
// anchor color shows. That measure is a heuristic, so it warns and never
// fails the run. It checks art/finals.json, every record and every source
// before it writes anything, and refuses a source that carries its maker's
// provenance (C2PA, EXIF or XMP), since a re-encode would drop it.
// Exit 0 every file passes, 1 a file fails, 2 usage error or a bad
// art/finals.json, 3 an input, record or token is missing, or a source
// carries provenance (nothing is written).
//
// Sizes per kind restate art/DIRECTION.md (Settings, The keepers). If they
// disagree, DIRECTION wins and this table is fixed in the same session.
// Heroes and regions ship at their rendered width until an upscale workflow
// exists (DIRECTION, Edits and upscales): interpolation adds bytes, not detail.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import YAML from "yaml";

import { TILES, checkTile, describeTile, optionValue, tileFromPng } from "./make-tiles.mjs";
import { loadBatch, pngProvenance, provenanceFor, readWebpXmp, setWebpXmp, webpChunks, xmpPacket } from "./provenance.mjs";

export { webpChunks };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ART_OUT = path.join(ROOT, "site/src/assets/art");
const CONCEPTS = path.join(ROOT, "art/concepts");

// width and height of the delivered file; null keeps the source (or crop) size.
export const KINDS = {
  hero: { size: null, ratio: 21 / 9, quality: 90 },
  region: { size: null, ratio: 16 / 9, quality: 90 },
  "keeper-large": { size: [960, 1200], quality: 90, ground: true },
  "keeper-small": { size: [320, 320], quality: 90, ground: true },
  // FIBO 2.0 on the Bria node: "16:9" at "4MP" came out 2048 x 1152 (batch 3, 2026-11-03).
  // Quality 80 keeps a scene under the site's 400 KB image limit (orchestrator, #713).
  scene: { size: null, ratio: 16 / 9, quality: 80, maxBytes: 400 * 1024 },
};

// The part of the plan one batch ships: its finals and its tiles.
export function batchPlan(plan, batch) {
  return {
    ...plan,
    finals: plan.finals.filter((e) => e.batch === batch),
    tiles: Object.fromEntries(Object.entries(plan.tiles ?? {}).filter(([k, t]) => k.startsWith("_") || t.batch === batch)),
  };
}

const AVATAR = 64; // px: the avatar size DIRECTION's 64 px legibility goal names
// Only clearly colored pixels count toward an anchor; the hue ranges live in
// art/finals.json, measured from the art.
const ANCHOR_MIN_SAT = 0.4;
const ANCHOR_MIN_VAL = 0.3;
const ANCHOR_GOAL = 0.08; // goal: share of the 64 px avatar in the keeper's own anchor

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// The flat ground a keeper render sits on: the median of its four corner patches.
export function sampleGround(rgb, w, h, patch = 8) {
  const chans = [[], [], []];
  for (const [cx, cy] of [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]]) {
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) for (let k = 0; k < 3; k++) chans[k].push(rgb[(y * w + x) * 3 + k]);
    }
  }
  return chans.map(median);
}

// Moves a render's flat ground to `target`. The ground is what a flood fill
// reaches from the border within `tol` levels of the corner color, so white
// inside the painting (a beard, a blank page) keeps its color. Pixels within
// `fringe` px of the ground shift in proportion to how close they are to it,
// which keeps the painted outline's anti-aliased edge clean.
export function replaceGround(rgb, w, h, target, { tol = 24, soft = 96, fringe = 2 } = {}) {
  const ground = sampleGround(rgb, w, h);
  const n = w * h;
  const dist = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    let m = 0;
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(rgb[p * 3 + k] - ground[k]));
    dist[p] = m;
  }
  const mask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (p) => {
    if (!mask[p] && dist[p] <= tol) {
      mask[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  const out = Buffer.from(rgb);
  const shift = [0, 1, 2].map((k) => target[k] - ground[k]);
  let groundPixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let s = 0;
      if (mask[p]) {
        s = 1;
        groundPixels++;
      } else {
        let near = false;
        for (let dy = -fringe; dy <= fringe && !near; dy++) {
          for (let dx = -fringe; dx <= fringe && !near; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[yy * w + xx]) near = true;
          }
        }
        if (near) s = Math.max(0, 1 - dist[p] / soft);
      }
      if (s) for (let k = 0; k < 3; k++) out[p * 3 + k] = Math.max(0, Math.min(255, Math.round(rgb[p * 3 + k] + shift[k] * s)));
    }
  }
  return { rgb: out, ground, share: groundPixels / n };
}

// True when `hue` falls in [from, to]; a range with from > to wraps through 0.
export function inHueRange(hue, [from, to]) {
  return from <= to ? hue >= from && hue <= to : hue >= from || hue <= to;
}

// Share of an avatar's pixels, inside the site's circle, in each anchor's hue range.
export async function anchorShares(file, anchors) {
  const { data, info } = await sharp(file).resize(AVATAR, AVATAR).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = AVATAR / 2;
  const counts = Object.fromEntries(Object.keys(anchors).map((k) => [k, 0]));
  let inside = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 > r * r) continue;
      inside++;
      const p = (y * info.width + x) * 3;
      const [hue, sat, val] = rgbToHsv([data[p], data[p + 1], data[p + 2]]);
      if (sat < ANCHOR_MIN_SAT || val < ANCHOR_MIN_VAL) continue;
      for (const [name, range] of Object.entries(anchors)) if (inHueRange(hue, range)) counts[name]++;
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / inside]));
}

// A viewer tells the keepers apart by color when each anchor shows most on its
// own keeper. `rows` maps an avatar's anchor to its anchorShares() result.
// Returns one warning per avatar that misses the goal or is outshone.
export function anchorWarnings(rows) {
  const warnings = [];
  for (const [anchor, shares] of Object.entries(rows)) {
    const own = shares[anchor];
    if (own < ANCHOR_GOAL) warnings.push(`${anchor}: ${(own * 100).toFixed(0)}% at ${AVATAR} px, under the ${ANCHOR_GOAL * 100}% goal`);
    for (const [other, otherShares] of Object.entries(rows)) {
      if (other !== anchor && otherShares[anchor] >= own) {
        warnings.push(`${anchor}: the ${other} avatar shows as much ${anchor} (${(otherShares[anchor] * 100).toFixed(0)}%) as its own`);
      }
    }
  }
  return warnings;
}

// A shipped file carries its own provenance packet and never ComfyUI's
// prompt graph, whose nodes all carry a "class_type" key.
export function provenanceProblems(buf, xmp) {
  const problems = [];
  const found = readWebpXmp(buf);
  if (found === null) problems.push("carries no provenance XMP");
  else if (xmp !== undefined && found !== xmp) problems.push("provenance XMP is not its record's (run --stamp)");
  if (buf.includes('"class_type"')) problems.push("carries ComfyUI's prompt graph");
  return problems;
}

// Every file this plan ships, finals and tiles, with the render it comes from.
export function shippedFiles(plan, artOut = ART_OUT) {
  return [
    ...plan.finals.map((e) => ({ out: e.out, batch: e.batch, from: e.from })),
    ...tileEntries(plan).map(([name, pick]) => ({ out: `textures/${name}`, batch: pick.batch, from: pick.from })),
  ].map((s) => ({ ...s, file: path.join(artOut, `${s.out}.webp`) }));
}

// The provenance packet for every shipped file, keyed by out. Returns
// { packets, problems }; any problem means a record cannot be built.
export function provenancePackets(plan, root = ROOT) {
  const packets = {};
  const problems = [];
  const batches = {};
  for (const s of shippedFiles(plan)) {
    try {
      batches[s.batch] ??= loadBatch(root, s.batch);
    } catch (err) {
      problems.push(`${s.out}: cannot read art/runs/batch-${s.batch}.json (${err.message})`);
      continue;
    }
    const rec = provenanceFor(s, batches[s.batch], plan.models);
    if (typeof rec === "string") problems.push(`${s.out}: ${rec}`);
    else packets[s.out] = xmpPacket(rec);
  }
  return { packets, problems };
}

// Decodes a delivered file and checks it against its kind and against `xmp`,
// the provenance packet its record makes.
export async function checkFinal(file, kind, xmp) {
  const spec = KINDS[kind];
  const buf = fs.readFileSync(file);
  const meta = await sharp(buf).metadata();
  const problems = [];
  if (meta.format !== "webp") problems.push(`format ${meta.format}, not webp`);
  const extra = webpChunks(buf).filter((c) => ["EXIF", "ICCP"].includes(c));
  if (extra.length) problems.push(`carries ${extra.join(", ")} metadata`);
  problems.push(...provenanceProblems(buf, xmp));
  if (spec.size && (meta.width !== spec.size[0] || meta.height !== spec.size[1])) {
    problems.push(`size ${meta.width} x ${meta.height}, not ${spec.size[0]} x ${spec.size[1]}`);
  }
  if (spec.maxBytes && buf.length > spec.maxBytes) problems.push(`${Math.round(buf.length / 1024)} KB, over the ${spec.maxBytes / 1024} KB limit`);
  if (spec.ratio && Math.abs(meta.width / meta.height - spec.ratio) / spec.ratio > 0.01) {
    problems.push(`ratio ${(meta.width / meta.height).toFixed(3)}, not ${spec.ratio.toFixed(3)}`);
  }
  return { problems, bytes: buf.length, width: meta.width, height: meta.height };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OUT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

// True when `rel` resolves to a path inside `dir`.
export function insideDir(dir, rel) {
  const root = path.resolve(dir);
  return path.resolve(root, rel).startsWith(root + path.sep);
}

export function sourcePath(inbox, batch, from) {
  return path.join(inbox, `batch-${batch}`, `${from}.png`);
}

function tileEntries(plan) {
  return Object.entries(plan.tiles ?? {}).filter(([k]) => !k.startsWith("_"));
}

// Checks art/finals.json before any path is built from it: out and from are
// slugs, batch is a positive integer, and every output lands inside artOut.
// Returns one line per problem; an empty list means the plan is usable.
export function planProblems(plan, artOut = ART_OUT) {
  if (!Array.isArray(plan?.finals)) return ["finals must be a list"];
  const problems = [];
  const batchOk = (b) => Number.isInteger(b) && b > 0;
  plan.finals.forEach((e, i) => {
    const at = `finals[${i}]`;
    if (typeof e.out !== "string" || !OUT_KEY.test(e.out)) problems.push(`${at}: out must be lowercase slugs joined by "/"`);
    else if (!insideDir(artOut, `${e.out}.webp`)) problems.push(`${at}: out resolves outside ${path.relative(ROOT, artOut)}`);
    if (typeof e.from !== "string" || !SLUG.test(e.from)) problems.push(`${at}: from must be a slug`);
    if (!batchOk(e.batch)) problems.push(`${at}: batch must be a positive integer`);
    if (!KINDS[e.kind]) problems.push(`${at}: unknown kind ${e.kind}`);
    if (e.crop !== undefined && !(Array.isArray(e.crop) && e.crop.length === 4 && e.crop.every((n) => Number.isInteger(n) && n >= 0))) {
      problems.push(`${at}: crop must be four whole numbers`);
    }
  });
  for (const [name, pick] of tileEntries(plan)) {
    if (!TILES[name]) problems.push(`tiles.${name}: not a tile make-tiles.mjs knows`);
    if (typeof pick?.from !== "string" || !SLUG.test(pick.from)) problems.push(`tiles.${name}: from must be a slug`);
    if (!batchOk(pick?.batch)) problems.push(`tiles.${name}: batch must be a positive integer`);
  }
  return problems;
}

// Every source a run reads, checked before anything is written, so a missing
// file never leaves the finals half rebuilt. Returns the missing paths.
export function missingSources(plan, inbox, previews) {
  const need = [
    ...plan.finals.map((e) => sourcePath(inbox, e.batch, e.from)),
    ...tileEntries(plan).map(([, pick]) => sourcePath(inbox, pick.batch, pick.from)),
  ];
  if (previews !== undefined) need.push(path.join(inbox, `batch-${previews}`));
  return [...new Set(need)].filter((f) => !fs.existsSync(f));
}

export async function makeFinal(entry, srcFile, colors, xmp) {
  const spec = KINDS[entry.kind];
  if (!spec) throw new Error(`${entry.out}: unknown kind ${entry.kind}`);
  const { data, info } = await sharp(srcFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let rgb = data;
  let groundShare = null;
  if (spec.ground) {
    const g = replaceGround(data, info.width, info.height, colors.ground);
    rgb = g.rgb;
    groundShare = g.share;
  }
  let img = sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } });
  if (entry.crop) {
    const [left, top, width, height] = entry.crop;
    if (left < 0 || top < 0 || left + width > info.width || top + height > info.height) {
      throw new Error(`${entry.out}: crop ${entry.crop.join(",")} falls outside ${info.width} x ${info.height}`);
    }
    img = img.extract({ left, top, width, height });
  }
  if (spec.size) img = img.resize(spec.size[0], spec.size[1], { fit: "fill", kernel: "lanczos3" });
  if (!insideDir(ART_OUT, `${entry.out}.webp`)) throw new Error(`${entry.out}: resolves outside ${ART_OUT}`);
  const out = path.join(ART_OUT, `${entry.out}.webp`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // sharp writes no metadata unless asked, so the only metadata is the
  // provenance packet; checkFinal proves it on the file.
  const webp = await img.webp({ quality: spec.quality, effort: 6, smartSubsample: true }).toBuffer();
  fs.writeFileSync(out, setWebpXmp(webp, xmp));
  return { out, groundShare };
}

export async function writePreviews(inbox, batch) {
  const dir = path.join(inbox, `batch-${batch}`);
  const outDir = path.join(CONCEPTS, `batch-${batch}`);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
    const out = path.join(outDir, f.replace(/\.png$/, ".webp"));
    await sharp(path.join(dir, f)).resize(480, 480, { fit: "inside" }).webp({ quality: 72, effort: 6 }).toFile(out);
    written.push(out);
  }
  return written;
}

export function loadTokens() {
  return YAML.parse(fs.readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8")).color;
}

// Rewrites only the XMP chunk of each shipped file, so the image chunks keep
// their bytes. Finds every file before it writes any. Returns the exit code.
export function stampShipped(plan, packets, artOut = ART_OUT) {
  const files = shippedFiles(plan, artOut);
  const missing = files.filter((s) => !fs.existsSync(s.file));
  if (missing.length) {
    for (const s of missing) console.error(`make-finals: missing ${path.relative(ROOT, s.file)}`);
    console.error("make-finals: nothing was written");
    return 3;
  }
  for (const s of files) {
    const before = fs.readFileSync(s.file);
    const current = readWebpXmp(before) === packets[s.out];
    if (!current) fs.writeFileSync(s.file, setWebpXmp(before, packets[s.out]));
    console.log(`make-finals: ${current ? "current" : "stamped"} ${path.relative(ROOT, s.file)}`);
  }
  return 0;
}

// Sources that carry their maker's provenance, which a re-encode would drop.
export function sourcesWithProvenance(plan, inbox) {
  const sources = [...new Set(shippedFiles(plan).map((s) => sourcePath(inbox, s.batch, s.from)))];
  return sources.map((file) => ({ file, found: pngProvenance(fs.readFileSync(file)) })).filter((s) => s.found.length);
}

async function main() {
  const args = process.argv.slice(2);
  const usage = "usage: node art/tools/make-finals.mjs --from <inbox with batch-<n>/> [--previews <n>] [--batch <n>]\n       node art/tools/make-finals.mjs --stamp";
  const stamp = args.includes("--stamp");
  let fromArg;
  let previews;
  let only;
  try {
    fromArg = optionValue(args, "--from");
    previews = optionValue(args, "--previews");
    only = optionValue(args, "--batch");
  } catch (err) {
    console.error(`make-finals: ${err.message}\n${usage}`);
    process.exit(2);
  }
  if (stamp ? fromArg !== undefined || previews !== undefined || only !== undefined : !fromArg) {
    console.error(usage);
    process.exit(2);
  }
  for (const [flag, value] of [["--previews", previews], ["--batch", only]]) {
    if (value !== undefined && !/^\d+$/.test(value)) {
      console.error(`make-finals: ${flag} takes a batch number`);
      process.exit(2);
    }
  }
  let tokens;
  let plan;
  try {
    tokens = loadTokens();
    plan = JSON.parse(fs.readFileSync(path.join(ROOT, "art/finals.json"), "utf8"));
  } catch (err) {
    console.error(`make-finals: could not read brand_tokens.yaml or art/finals.json: ${err.message}`);
    process.exit(3);
  }
  const problems = planProblems(plan);
  if (problems.length) {
    for (const p of problems) console.error(`make-finals: art/finals.json ${p}`);
    process.exit(2);
  }
  const { packets, problems: recordProblems } = provenancePackets(plan);
  if (recordProblems.length) {
    for (const p of recordProblems) console.error(`make-finals: no provenance record for ${p}`);
    console.error("make-finals: nothing was written");
    process.exit(3);
  }
  if (stamp) process.exit(stampShipped(plan, packets));
  const inbox = path.resolve(fromArg);
  const todo = only === undefined ? plan : batchPlan(plan, Number(only));
  if (!todo.finals.length && !tileEntries(todo).length) {
    console.error(`make-finals: art/finals.json ships nothing from batch ${only}`);
    process.exit(2);
  }
  const anchors = Object.fromEntries(Object.entries(plan.anchors ?? {}).filter(([k]) => !k.startsWith("_")));
  const unknown = plan.finals.map((e) => e.anchor).filter((a) => a && !anchors[a]);
  if (unknown.length) {
    console.error(`make-finals: art/finals.json gives no hue range for ${[...new Set(unknown)].join(", ")}`);
    process.exit(2);
  }
  for (const name of [plan.ground.token, ...Object.keys(anchors)]) {
    if (!tokens[name]) {
      console.error(`make-finals: brand_tokens.yaml has no "${name}" color`);
      process.exit(3);
    }
  }
  const colors = { ground: hexToRgb(tokens[plan.ground.token]) };
  const missing = missingSources(todo, inbox, previews);
  if (missing.length) {
    for (const f of missing) console.error(`make-finals: missing ${f}`);
    console.error("make-finals: nothing was written");
    process.exit(3);
  }
  const carried = sourcesWithProvenance(todo, inbox);
  if (carried.length) {
    for (const { file, found } of carried) {
      console.error(`make-finals: ${file} carries ${found.join(", ")} from its maker; a re-encode would drop it, so ship that render's own bytes (art/LICENSES.md, Duties)`);
    }
    console.error("make-finals: nothing was written");
    process.exit(3);
  }

  let failed = 0;
  const avatarRows = {};
  for (const entry of todo.finals) {
    const { out, groundShare } = await makeFinal(entry, sourcePath(inbox, entry.batch, entry.from), colors, packets[entry.out]);
    const result = await checkFinal(out, entry.kind, packets[entry.out]);
    const notes = [];
    if (groundShare !== null) notes.push(`ground ${(groundShare * 100).toFixed(0)}% moved to ${plan.ground.token}`);
    if (entry.anchor) {
      const shares = await anchorShares(out, anchors);
      avatarRows[entry.anchor] = shares;
      notes.push(`at ${AVATAR} px: ${Object.entries(shares).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ")}`);
    }
    if (result.problems.length) failed++;
    console.log(
      `make-finals: ${result.problems.length ? "FAIL" : "ok"} ${path.relative(ROOT, out)} ${result.width} x ${result.height}, ${Math.round(result.bytes / 1024)} KB` +
        (notes.length ? `; ${notes.join("; ")}` : "") +
        (result.problems.length ? `: ${result.problems.join("; ")}` : ""),
    );
  }
  for (const w of anchorWarnings(avatarRows)) console.log(`make-finals: warn ${w}`);
  // Texture tiles: the same method and checks as make-tiles.mjs, from the renders
  // picked here, then the provenance packet and the checks again on the shipped bytes.
  for (const [name, pick] of tileEntries(todo)) {
    const out = path.join(ART_OUT, "textures", `${name}.webp`);
    const made = await tileFromPng(sourcePath(inbox, pick.batch, pick.from), out, TILES[name], tokens);
    const packet = packets[`textures/${name}`];
    fs.writeFileSync(out, setWebpXmp(fs.readFileSync(out), packet));
    const result = { ...made, ...(await checkTile(out, TILES[name], tokens)) };
    result.problems.push(...provenanceProblems(fs.readFileSync(out), packet));
    if (result.problems.length) failed++;
    console.log(`make-finals: tile ${describeTile(result, out, TILES[name])}`);
  }
  if (previews !== undefined) {
    const written = await writePreviews(inbox, previews);
    console.log(`make-finals: wrote ${written.length} previews to ${path.relative(ROOT, path.dirname(written[0] ?? CONCEPTS))}`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
