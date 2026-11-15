// Pulls the brand's released art into the site, pinned by brand.lock.json.
// Colorado-Startups/brand is the one home for the brand (brand decisions 6 and
// 10); the site never hand-copies an image. Each file is checked against the
// sha256 in the lock, which comes from the brand release's own table.
//
//   node scripts/brand/pull.mjs              download, verify, write originals and webp sizes
//   node scripts/brand/pull.mjs --check      offline: originals match the lock, every size exists
//   node scripts/brand/pull.mjs --self-test  known-bad and known-clean samples
//
// Writes site/public/art/brand/<name>.jpg (the original) and <name>-<w>.webp
// for each width in WIDTHS that the original can fill. The webp sizes keep the
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

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
export const stem = (path) => basename(path).replace(/\.[a-z]+$/i, "");
export const sizeName = (path, w) => `${stem(path)}-${w}.webp`;

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
  for (const [path, want] of Object.entries(lock.files)) {
    const file = join(root, OUT, basename(path));
    if (!existsSync(file)) { problems.push(`${basename(path)}: missing; run npm run brand:pull`); continue; }
    const got = sha256(readFileSync(file));
    if (got !== want) problems.push(`${basename(path)}: sha256 ${got.slice(0, 12)} is not the lock's ${want.slice(0, 12)}`);
    for (const w of WIDTHS) {
      if (!existsSync(join(root, OUT, sizeName(path, w)))) problems.push(`${sizeName(path, w)}: missing; run npm run brand:pull`);
    }
  }
  return problems;
}

async function pull(lock) {
  const { default: sharp } = await import("sharp");
  mkdirSync(join(ROOT, OUT), { recursive: true });
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
    const { width } = await sharp(buf).metadata();
    for (const w of WIDTHS.filter((w) => w <= width)) {
      await sharp(buf).resize({ width: w }).keepMetadata().webp({ quality: 80 }).toFile(join(ROOT, OUT, sizeName(path, w)));
    }
    console.log(`brand: ${basename(path)} ok (${lock.tag})`);
  }
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "brand-pull-"));
  try {
    mkdirSync(join(dir, OUT), { recursive: true });
    const clean = Buffer.from("clean");
    writeFileSync(join(dir, OUT, "a.jpg"), clean);
    for (const w of WIDTHS) writeFileSync(join(dir, OUT, sizeName("a.jpg", w)), "x");
    const lock = { repo: "o/r", tag: "t", files: { "dist/a.jpg": sha256(clean) } };
    const ok = checkFiles(lock, dir).length === 0;
    writeFileSync(join(dir, OUT, "a.jpg"), "tampered");
    const bad = checkFiles(lock, dir).some((p) => p.includes("sha256"));
    if (!ok || !bad) { console.error(`brand self-test: FAIL (clean ${ok}, bad caught ${bad})`); return 1; }
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
