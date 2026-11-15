// Pulls the brand's released art into the site, pinned by brand.lock.json.
// Colorado-Startups/brand is the one home for the brand (brand decisions 6 and
// 10); the site never hand-copies an image. Each file is checked against the
// sha256 in the lock, which comes from the brand release's own table.
//
//   node scripts/brand/pull.mjs              download, verify, write originals and webp sizes
//   node scripts/brand/pull.mjs --check      offline: originals match the lock, every size exists
//   node scripts/brand/pull.mjs --self-test  known-bad and known-clean samples
//
// Writes site/public/art/brand/<name>.<ext> (the original), <name>-<w>.webp for
// each width widthsFor() gives, and sizes.json, which records each picture's
// size and widths for art-assets.ts brandArt(). The webp sizes keep the
// image's metadata (sharp keepMetadata): its AI-made label and photo credit
// live there (brand decision 46, Bria's terms), and Astro's image pipeline
// would strip them, so these files are served as-is.
// Exit codes (04_tools/README.md): 0 clean, 1 a mismatch or missing file,
// 2 usage error, 3 could not check.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = "site/public/art/brand";
export const WIDTHS = [720, 1440];
export const SIZES = "sizes.json";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
export const stem = (path) => basename(path).replace(/\.[a-z]+$/i, "");
export const sizeName = (path, w) => `${stem(path)}-${w}.webp`;
// Pictures get webp sizes and a sizes.json entry; any other file (tokens.json) is copied as it is.
export const isPicture = (path) => /\.(png|jpe?g|webp)$/i.test(path);

// The webp widths for an original `width` px wide: each of WIDTHS it can fill,
// plus its own width when it falls short of the widest, so a 960 px keeper gets
// 720 and 960 and a 320 px crop gets 320. Never an upscale.
export function widthsFor(width) {
  const fit = WIDTHS.filter((w) => w <= width);
  if (width < WIDTHS.at(-1) && !fit.includes(width)) fit.push(width);
  return fit;
}

export function readLock(root = ROOT) {
  const lock = JSON.parse(readFileSync(join(root, "brand.lock.json"), "utf8"));
  if (!/^[\w.-]+\/[\w.-]+$/.test(lock.repo ?? "") || !lock.tag || typeof lock.files !== "object") {
    throw new Error("brand.lock.json needs repo (owner/name), tag and files");
  }
  return lock;
}

// Problems with the files on disk, one line each; [] when clean.
export function checkFiles(lock, root = ROOT) {
  const problems = [];
  const sizesFile = join(root, OUT, SIZES);
  const sizes = existsSync(sizesFile) ? JSON.parse(readFileSync(sizesFile, "utf8")) : {};
  for (const [path, want] of Object.entries(lock.files)) {
    const file = join(root, OUT, basename(path));
    if (!existsSync(file)) { problems.push(`${basename(path)}: missing; run npm run brand:pull`); continue; }
    const got = sha256(readFileSync(file));
    if (got !== want) problems.push(`${basename(path)}: sha256 ${got.slice(0, 12)} is not the lock's ${want.slice(0, 12)}`);
    if (!isPicture(path)) continue;
    const entry = sizes[stem(path)];
    if (!entry || entry.file !== basename(path)) { problems.push(`${SIZES}: no entry for ${basename(path)}; run npm run brand:pull`); continue; }
    for (const w of entry.widths) {
      if (!existsSync(join(root, OUT, sizeName(path, w)))) problems.push(`${sizeName(path, w)}: missing; run npm run brand:pull`);
    }
  }
  return problems;
}

async function pull(lock) {
  const { default: sharp } = await import("sharp");
  mkdirSync(join(ROOT, OUT), { recursive: true });
  const sizes = {};
  for (const [path, want] of Object.entries(lock.files)) {
    const url = `https://raw.githubusercontent.com/${lock.repo}/${lock.tag}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== want) {
      console.error(`brand: ${path}: sha256 ${got} is not the lock's ${want}`);
      process.exit(1);
    }
    writeFileSync(join(ROOT, OUT, basename(path)), buf);
    if (!isPicture(path)) { console.log(`brand: ${basename(path)} ok (${lock.tag})`); continue; }
    const { width, height } = await sharp(buf).metadata();
    const widths = widthsFor(width);
    for (const w of widths) {
      await sharp(buf).resize({ width: w }).keepMetadata().webp({ quality: 80 }).toFile(join(ROOT, OUT, sizeName(path, w)));
    }
    sizes[stem(path)] = { file: basename(path), width, height, widths };
    console.log(`brand: ${basename(path)} ok (${lock.tag})`);
  }
  writeFileSync(join(ROOT, OUT, SIZES), `${JSON.stringify(sizes, null, 2)}\n`);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "brand-pull-"));
  try {
    mkdirSync(join(dir, OUT), { recursive: true });
    const clean = Buffer.from("clean");
    writeFileSync(join(dir, OUT, "a.jpg"), clean);
    for (const w of widthsFor(960)) writeFileSync(join(dir, OUT, sizeName("a.jpg", w)), "x");
    writeFileSync(join(dir, OUT, SIZES), JSON.stringify({ a: { file: "a.jpg", width: 960, height: 1200, widths: widthsFor(960) } }));
    writeFileSync(join(dir, OUT, "t.json"), "{}");
    const lock = { repo: "o/r", tag: "t", files: { "dist/a.jpg": sha256(clean), "dist/t.json": sha256(Buffer.from("{}")) } };
    const ok = checkFiles(lock, dir).length === 0;
    const widthsOk = JSON.stringify([widthsFor(1440), widthsFor(960), widthsFor(320)]) === "[[720,1440],[720,960],[320]]";
    rmSync(join(dir, OUT, sizeName("a.jpg", 960)));
    const missing = checkFiles(lock, dir).some((p) => p.includes("a-960.webp"));
    writeFileSync(join(dir, OUT, "a.jpg"), "tampered");
    const bad = checkFiles(lock, dir).some((p) => p.includes("sha256"));
    if (!ok || !bad || !missing || !widthsOk) {
      console.error(`brand self-test: FAIL (clean ${ok}, bad caught ${bad}, missing size caught ${missing}, widths ${widthsOk})`);
      return 1;
    }
    console.log("brand self-test: PASS");
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg && !["--check", "--self-test"].includes(arg)) { console.error("usage: node scripts/brand/pull.mjs [--check | --self-test]"); process.exit(2); }
  if (arg === "--self-test") process.exit(selfTest());
  let lock;
  try { lock = readLock(); } catch (e) { console.error(`brand: ${e.message}`); process.exit(3); }
  if (arg === "--check") {
    const problems = checkFiles(lock);
    for (const p of problems) console.error(`brand: ${p}`);
    if (!problems.length) console.log(`brand: ${Object.keys(lock.files).length} files match ${lock.tag}`);
    process.exit(problems.length ? 1 : 0);
  }
  pull(lock).catch((e) => { console.error(`brand: ${e.message}`); process.exit(3); });
}
