// Paths, constants and helpers the review-copy builder shares
// (inline-page.mjs, page.mjs, chrome.mjs, guides.mjs): routes, data: URIs, the
// texture tiles, the art count and the commit stamps.

import { readFileSync, existsSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "site/dist");
const MANIFEST = path.join(ROOT, "ops/artifacts/artifacts.json");
const OUT = path.join(ROOT, "ops/artifacts/pages");
const INDEX = path.join(ROOT, "ops/artifacts/index.md");
const ART_DIR = path.join(ROOT, "site/src/assets/art");

// The Artifact tool refuses a rendered page over 16 MB (its own documentation).
const MAX_BYTES = 16 * 1024 * 1024;
// A review copy never calls the site's API or loads Turnstile.
const DROP_RULES = [
  { pattern: /\/api\//, reason: "calls /api/" },
  { pattern: /challenges\.cloudflare\.com/, reason: "loads Turnstile" },
];
// Review copies need one width per image, not every srcset candidate.
const MAX_IMAGE_WIDTH = 2000;

const MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function fail(code, message) {
  console.error(`inline-page: ${message}`);
  process.exit(code);
}

// "community/index.html" -> "/community/"; "404.html" -> "/404.html".
function routeOf(file) {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file}`;
}

// "/community?x#y" -> "/community/"; "/brand/logo.png" stays as it is.
// CHROME_JS embeds this function's source, so it uses nothing from this module.
function normalizeRoute(href) {
  const p = href.split(/[?#]/)[0] || "/";
  return p.endsWith("/") || /\.[a-z0-9]+$/i.test(p) ? p : `${p}/`;
}

// A local file inside the build, or null. Never reads outside site/dist.
function localFile(ref, baseDir) {
  if (!ref) return null;
  const value = ref.trim();
  if (!value || /^(data:|blob:|https?:|\/\/|#|mailto:|tel:)/i.test(value)) return null;
  let clean;
  try {
    clean = decodeURIComponent(value.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const file = clean.startsWith("/") ? path.join(DIST, clean) : path.resolve(baseDir, clean);
  if (!file.startsWith(DIST + path.sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const uriCache = new Map();
function dataUri(file) {
  let uri = uriCache.get(file);
  if (!uri) {
    const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    uri = `data:${mime};base64,${readFileSync(file).toString("base64")}`;
    uriCache.set(file, uri);
  }
  return uri;
}

function inlineCss(css, baseDir, notes) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote, ref) => {
    const file = localFile(ref, baseDir);
    if (file) return `url("${dataUri(file)}")`;
    if (!/^(data:|#)/.test(ref.trim())) notes.unresolved.add(ref.trim());
    return match;
  });
}

// The widest candidate up to MAX_IMAGE_WIDTH, else the narrowest one above it.
function pickCandidate(srcset) {
  const list = srcset
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor = "1x"] = part.split(/\s+/);
      const n = Number.parseFloat(descriptor) || 1;
      return { url, width: descriptor.endsWith("w") ? n : n * 1000 };
    })
    .sort((a, b) => a.width - b.width);
  const fits = list.filter((c) => c.width <= MAX_IMAGE_WIDTH);
  return (fits.at(-1) ?? list[0])?.url ?? null;
}

function scriptName(file) {
  return path.basename(file).split(/[.]/)[0];
}

function hostOf(url) {
  try {
    return new URL(url, "https://coloradostartups.org").host;
  } catch {
    return url;
  }
}

// Short names for the outside scripts the review bar lists.
const KNOWN_HOSTS = { "challenges.cloudflare.com": "Turnstile" };

// Escape the one sequence that would end an inline <script> or <style> early.
function safeInline(code, tag) {
  return code.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

// The tiles HallTextures turns into --tex-* on the site
// (site/src/components/ui/HallTextures.astro), in its order and file types.
const TEXTURES = ["stone", "parchment", "night-stone"];
// png before webp: HallTextures takes the first match of Vite's sorted glob.
const TEXTURE_TYPES = [
  ["png", "image/png"],
  ["webp", "image/webp"],
];

// The brand guide's --tex-* rule, with each tile inlined, so its stone, night
// and parchment specimens wear the same tiles as the site. Empty when no tile
// exists, which leaves the flat token colors, as on the site. The guide is
// published, so a tile must be a regular file (not a symlink) inside
// site/src/assets with no dot folder on its path, as docImageFile() requires
// of a guide's images. Anything else throws, and the run exits 1.
function texturesCss(dir = path.join(ART_DIR, "textures"), allowed = path.join(ROOT, "site/src/assets")) {
  const decls = [];
  for (const name of TEXTURES) {
    for (const [ext, mime] of TEXTURE_TYPES) {
      const file = path.join(dir, `${name}.${ext}`);
      let stat;
      try {
        stat = lstatSync(file);
      } catch {
        continue; // no tile of this type
      }
      if (!stat.isFile()) throw new Error(`refusing ${file}: not a regular file`);
      if (!isInside(file, allowed)) throw new Error(`refusing ${file}: outside ${allowed}`);
      if (path.relative(realish(allowed), realish(file)).split(path.sep).some((part) => part.startsWith("."))) {
        throw new Error(`refusing ${file}: a dotfile`);
      }
      decls.push(`--tex-${name}:url("data:${mime};base64,${readFileSync(file).toString("base64")}")`);
      break;
    }
  }
  return decls.length ? `:root{${decls.join(";")}}` : "";
}

function textureNoteHtml(css) {
  return css
    ? "Stone, night and the parchment callout wear L7's texture tiles from <code>site/src/assets/art/textures/</code>, the same files the site uses."
    : "Stone, night and the parchment callout pick up L7's texture tiles when they land; until then the flat color shows (global.css).";
}

// The brand guide's line on the art, after "As of <build>,", from the count of
// files in site/src/assets/art.
function artStatusHtml(n) {
  if (n === 0) return "no rendered art has landed in <code>site/src/assets/art/</code>, so every page shows its placeholder.";
  const [files, shows] = n === 1 ? ["file has", "it"] : ["files have", "them"];
  return `${n} art ${files} landed in <code>site/src/assets/art/</code>, and each page copy shows ${shows} where the page has an art slot. Picks and reasons are in <code>art/concepts/</code>.`;
}

// The extensions site/src/components/art/art-assets.ts loads ({webp,png,jpg}),
// so the count is the art the site can show.
const ART_EXT = /\.(webp|png|jpg)$/;

function countArt(dir = ART_DIR) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (ART_EXT.test(entry.name)) n += 1;
    }
  };
  walk(dir);
  return n;
}

// What a page is built from. Tests render nothing, so they never move the stamp.
const SITE_PATHS = ["site", "data", "packages", "01_doctrine", ":(exclude)site/test", ":(exclude)site/e2e"];

// Name the main commit the site was built from when the site files match it,
// so the stamp is a commit Paul can find on main. A branch with its own site
// changes is stamped with its own last site commit instead.
function siteCommit() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  try {
    const base = git("merge-base", "HEAD", "origin/main");
    const same = git("diff", "--name-only", base, "HEAD", "--", ...SITE_PATHS) === "";
    if (same) return `main ${git("log", "-1", "--format=%h %cs", base)}`;
    return `branch ${git("log", "-1", "--format=%h %cs", "--", ...SITE_PATHS)}`;
  } catch {
    return "unknown commit";
  }
}

// The commit that last changed a hand-written guide (a path from the repo
// root). Its facts are as of that commit; nothing rechecks them at build time,
// so the build commit alone would overstate them (#551).
function writtenCommit(rel) {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  try {
    const last = git("log", "-1", "--format=%h %cs", "--", rel);
    if (!last) return "an uncommitted draft";
    return git("status", "--porcelain", "--", rel) ? `${last}, edited since` : last;
  } catch {
    return "unknown commit";
  }
}

// Built pages the manifest does not name. The run exits 1 on any, so a new
// route gets a review copy the next time someone runs this script.
function unlistedPages(dir, manifest) {
  const listed = new Set(manifest.pages.map((p) => p.file));
  return listBuiltPages(dir).filter((file) => !listed.has(file));
}

function listBuiltPages(dir = DIST, prefix = "") {
  const pages = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "_astro" || entry.name === "pagefind") continue;
      pages.push(...listBuiltPages(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".html")) {
      pages.push(rel);
    }
  }
  return pages;
}


// A path with its symlinks resolved. For a missing path, the nearest parent
// that exists is resolved and the rest is appended, so a missing file is
// judged by where it would land.
function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(existsSync(cur) ? realpathSync(cur) : cur, ...rest);
}

// True when a path, after resolving symlinks, sits inside dir.
function isInside(file, dir) {
  return realish(file).startsWith(realish(dir) + path.sep);
}

export { artStatusHtml, countArt, dataUri, DIST, DROP_RULES, fail, hostOf, INDEX, inlineCss, isInside, KNOWN_HOSTS, localFile, MANIFEST, MAX_BYTES, normalizeRoute, OUT, pickCandidate, ROOT, routeOf, safeInline, scriptName, siteCommit, textureNoteHtml, texturesCss, unlistedPages, writtenCommit };
