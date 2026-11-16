// The Engagement tab: a site's engagement goals, read from its live pages and
// its repo, so a goal is measured, not eyeballed. Collector contract: Git
// Crafter quality/collectors/README.md.
//
// Nothing here names a repo, a path or a page. Each metric's targets entry
// says what to read in params.measure. params.origin names the site, and
// params.sitemap its sitemap, for a names read over every page:
//
//   read: "marks"     one page; elements carrying any of `marks` ("data-x" or
//                     "data-x=value"), only those a visitor sees before a click
//                     with `visible`, each value once with `distinct`. `min`
//                     ({ mark: least count }) reads not measured when a mark the
//                     count leans on is missing, so a changed page is no pass
//   read: "pages"     each of `pages`; how many carry every one of `marks`
//   read: "names"     the names `list.pattern` finds in `list.file`; how many a
//                     page marks (`marks`, on `pages` or every page in the
//                     sitemap) or a source file sends (`calls.pattern` in the
//                     `calls.ext` files under `calls.paths`)
//   read: "source"    distinct matches of `pattern` in the `ext` files under `paths`
//   read: "records"   a JSON or YAML file's records (at `path`): a count, those
//                     with a true `where` field, or with `share` the percent
//                     that have any of `has_any`
//   read: "files"     files in `dir` with an `ext`; a missing folder is 0 only
//                     with `absent_is_zero`, since git keeps no empty folder
//   read: "listings"  `items`: each a file in the repo, or a manual flag with
//                     the day it was set
//   read: "redirect"  steps on other sites between `path` and a host in
//                     `done_hosts`, following the live redirects
//   read: "outside"   a service this run cannot read: not measured, `reason`
//
// Source reads leave out comments in code files, so a commented-out call or a
// note never counts. A page is fetched with its redirects followed only while
// they stay on the site, and once more after a short wait when the first try
// meets a network error or a 5xx.
//
// Every read resolves to a value or to could_not_check with its reason. A page
// that does not answer, a file that is missing or a pattern that finds no
// list is never read as 0.
//
// Run alone: node quality/collectors/engagement/engagement.mjs <targets file>
// prints what the collector reads, with the repo root as the current folder.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { countMarks, markValues, sitemapLocs } from "./engagement-html.mjs";

export const area = "engagement";

const UA = "quality-collector (Engagement tab)";
const TIMEOUT_MS = 30_000;
const MAX_HOPS = 5;
const AT_ONCE = 4;
// The wait before the one retry of a page after a network error or a 5xx.
const RETRY_MS = 500;
// The source label of a reading that never reached its own read.
const OWN = "engagement collector";
const TEXT_EXT = [".astro", ".ts", ".mts", ".mjs", ".js", ".json", ".css", ".html", ".md", ".yaml", ".yml"];
// Files whose comments a source read leaves out: // and /* */, and <!-- --> in .astro.
const CODE_EXT = new Set([".astro", ".ts", ".mts", ".mjs", ".js"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".astro", ".wrangler"]);
// Sitemap paths never fetched: an /api/ route can act on a GET.
const SITEMAP_SKIP = ["/api/"];

const firstLine = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 300);

// A measured metric, and one that could not be read.
const measured = (value, source, detail, readAt) => ({ value, ...(detail?.length ? { detail } : {}), source, read_at: readAt });
const unread = (reason, source) => ({ could_not_check: reason, source });

// ---------- the site ----------

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

// The site params.origin names, with one fetch per page for the whole run.
// Every GET sets redirect "manual", so no request ever goes to another host.
function siteFor(params, fetchImpl, retryMs) {
  let origin = null;
  try {
    origin = new URL(params.origin).origin;
  } catch {
    // No origin, or not a URL: every read on the site is not measured.
  }
  const pages = new Map();
  const ua = params.user_agent || UA;
  const once = (url) =>
    fetchImpl(url, { redirect: "manual", headers: { "user-agent": ua, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  // One GET, tried once more after retryMs when it meets a network error or a 5xx.
  const get = async (url) => {
    try {
      const res = await once(url);
      if (res.status < 500) return res;
      await res.body?.cancel?.();
    } catch {
      // A network error: the one retry below answers for it.
    }
    await pause(retryMs);
    return once(url);
  };
  // A page's text, or { error }, following its redirects while they stay on the site.
  const page = (path) => {
    if (!pages.has(path)) {
      pages.set(
        path,
        (async () => {
          try {
            let at = new URL(path, origin);
            for (let hop = 0; hop <= MAX_HOPS; hop++) {
              const res = await get(at.href);
              const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
              if (!location) {
                if (!res.ok) return { error: `GET ${path} answered ${res.status}` };
                return { text: await res.text() };
              }
              await res.body?.cancel?.();
              const next = new URL(location, at);
              if (next.origin !== origin) return { error: `GET ${path} redirects off the site, to ${next.host}` };
              at = next;
            }
            return { error: `GET ${path}: more than ${MAX_HOPS} redirects` };
          } catch (e) {
            return { error: `GET ${path}: ${firstLine(e)}` };
          }
        })(),
      );
    }
    return pages.get(path);
  };
  return { origin, page, get };
}

// Many pages, AT_ONCE at a time, in the order given.
async function pagesText(site, paths) {
  const out = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      out[i] = { path: paths[i], ...(await site.page(paths[i])) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, paths.length) }, worker));
  return out;
}

// The site's pages from its sitemap (params.sitemap), one index level deep,
// same origin only, none under params.sitemap_skip (default /api/), at most
// params.max_pages.
async function sitemapPages(site, params) {
  if (typeof params.sitemap !== "string" || !params.sitemap) throw new Error("params.sitemap names no sitemap");
  const index = await site.page(params.sitemap);
  if (index.error) throw new Error(`sitemap: ${index.error}`);
  const skip = params.sitemap_skip ?? SITEMAP_SKIP;
  const own = (u) => {
    try {
      const url = new URL(u);
      return url.origin === site.origin && !skip.some((s) => url.pathname.startsWith(s)) ? url.pathname : null;
    } catch {
      return null;
    }
  };
  let locs = sitemapLocs(index.text).map(own).filter(Boolean);
  const children = locs.filter((p) => p.endsWith(".xml"));
  if (children.length) {
    const got = await pagesText(site, children);
    const failed = got.find((g) => g.error);
    if (failed) throw new Error(`sitemap: ${failed.error}`);
    locs = got.flatMap((g) => sitemapLocs(g.text).map(own).filter(Boolean));
  }
  const max = Number(params.max_pages ?? 200);
  const pages = [...new Set(locs)];
  if (!pages.length) throw new Error("the sitemap lists no page on the site");
  return { pages: pages.slice(0, max), cut: Math.max(0, pages.length - max) };
}

// ---------- the repo ----------

// Text files under `paths` (files or folders, relative to root) with an extension in `ext`.
function textFiles(root, paths, ext = TEXT_EXT) {
  const files = [];
  const walk = (abs) => {
    const st = statSync(abs);
    if (st.isFile()) {
      if (ext.includes(extname(abs))) files.push(abs);
      return;
    }
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      walk(join(abs, e.name));
    }
  };
  for (const p of paths) {
    const abs = resolve(root, p);
    if (!existsSync(abs)) throw new Error(`${p} is not in the repo`);
    walk(abs);
  }
  return files;
}

// Code with its comments blanked out: // to the line's end, /* */, and with
// `html` <!-- -->. Strings stay, so a "//" inside a URL is no comment; a ' or
// " string ends at its line, so an apostrophe in a template's prose swallows
// at most one line. Newlines stay, so a match keeps its line.
export function withoutComments(text, { html = false } = {}) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    let end = -1;
    if (two === "//") end = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
    else if (two === "/*") end = text.indexOf("*/", i + 2) < 0 ? text.length : text.indexOf("*/", i + 2) + 2;
    else if (html && text.startsWith("<!--", i)) end = text.indexOf("-->", i + 4) < 0 ? text.length : text.indexOf("-->", i + 4) + 3;
    if (end >= 0) {
      out += blank(text.slice(i, end));
      i = end;
      continue;
    }
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && !(c !== "`" && text[j] === "\n")) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Distinct values `pattern` finds in the files: its first group, else the
// match. Comments in code files are left out.
function sourceMatches(root, paths, pattern, ext) {
  const re = new RegExp(pattern, "gm");
  const found = new Map();
  for (const abs of textFiles(root, paths, ext)) {
    const raw = readFileSync(abs, "utf8");
    const text = CODE_EXT.has(extname(abs)) ? withoutComments(raw, { html: extname(abs) === ".astro" }) : raw;
    for (const m of text.matchAll(re)) {
      const name = m[1] ?? m[0];
      if (!found.has(name)) found.set(name, relative(root, abs).split(sep).join("/"));
    }
  }
  return found;
}

// A repo file's text. The error names the file from the root, never an absolute path.
function repoText(root, file) {
  const abs = resolve(root, file);
  if (!existsSync(abs)) throw new Error(`${file} is not in the repo`);
  return readFileSync(abs, "utf8");
}

// A data file's object: JSON, or YAML through the repo's own yaml package.
async function readData(root, file) {
  const text = repoText(root, file);
  if (extname(file) === ".json") return JSON.parse(text);
  const { parse } = await import("yaml");
  return parse(text);
}

const filled = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
const recordName = (r, i) => String(r?.id ?? r?.name ?? r?.file ?? `record ${i + 1}`);

// ---------- the reads ----------

const pageWords = (m) => `${m.visible ? ", outside any hidden element or template" : ""}${m.distinct ? ", each value once" : ""}`;

async function readMarks(m, { site }) {
  const source = `state: the live page ${site.origin}${m.page}: elements carrying ${m.marks.join(" or ")}${pageWords(m)}`;
  const got = await site.page(m.page);
  if (got.error) return unread(got.error, source);
  const counts = countMarks(got.text, m.marks, m);
  // A mark under its least count means the page no longer says what this read counts.
  const short = Object.entries(m.min ?? {}).find(([mark, least]) => (counts.find((c) => c.mark === mark)?.count ?? 0) < least);
  if (short) return unread(`not measured: ${m.page} carries ${counts.find((c) => c.mark === short[0])?.count ?? 0} ${short[0]}, under the ${short[1]} this read needs, so the page may have changed`, source);
  const labels = m.labels ?? {};
  return { value: counts.reduce((s, c) => s + c.count, 0), detail: counts.map((c) => ({ label: labels[c.mark] ?? c.mark, value: c.count })), source };
}

async function readPages(m, { site }) {
  const source = `state: ${m.pages.length} live pages on ${site.origin}: how many carry ${m.marks.join(" and ")}${pageWords(m)}`;
  const got = await pagesText(site, m.pages);
  const failed = got.filter((g) => g.error);
  if (failed.length) return unread(failed.map((g) => g.error).join("; "), source);
  const detail = got.map((g) => {
    const counts = countMarks(g.text, m.marks, m);
    const missing = counts.filter((c) => c.count === 0).map((c) => c.mark);
    return { label: missing.length ? `${g.path}: no ${missing.join(", no ")}` : g.path, value: missing.length ? 0 : 1, unit: "" };
  });
  return { value: detail.reduce((s, d) => s + d.value, 0), detail, source };
}

async function readNames(m, { site, root, params }) {
  const listed = [...new Set([...repoText(root, m.list.file).matchAll(new RegExp(m.list.pattern, "gm"))].map((x) => x[1]))];
  const where = m.pages === "sitemap" ? await sitemapPages(site, params) : { pages: m.pages, cut: 0 };
  const sent = m.calls ? sourceMatches(root, m.calls.paths, m.calls.pattern, m.calls.ext) : new Map();
  const pagesWord = m.pages === "sitemap" ? `every page in the sitemap (${where.pages.length}${where.cut ? `, ${where.cut} past params.max_pages left out` : ""})` : `${where.pages.length} pages`;
  const source = `state: the names ${m.list.file} lists, each wired when ${pagesWord} on ${site.origin} marks it in ${m.marks.join(" or ")}${m.calls ? `, or a file under ${m.calls.paths.join(", ")} sends it` : ""}`;
  if (!listed.length) return unread(`the list pattern finds no name in ${m.list.file}`, source);
  const got = await pagesText(site, where.pages);
  const failed = got.filter((g) => g.error);
  if (failed.length) return unread(`${failed.length} of ${got.length} pages did not answer: ${failed.slice(0, 3).map((g) => g.error).join("; ")}`, source);
  const marked = new Map();
  for (const g of got) {
    for (const values of markValues(g.text, m.marks).values()) for (const v of values) marked.set(v, (marked.get(v) ?? 0) + 1);
  }
  const how = (n) => (marked.has(n) ? `marked on ${marked.get(n)} ${marked.get(n) === 1 ? "page" : "pages"}` : sent.has(n) ? `sent from ${sent.get(n)}` : "not wired");
  const detail = listed.map((n) => ({ label: `${n}: ${how(n)}`, value: marked.has(n) || sent.has(n) ? 1 : 0, unit: "" }));
  return { value: detail.reduce((s, d) => s + d.value, 0), detail: detail.sort((a, b) => a.value - b.value), source };
}

async function readSource(m, { root }) {
  const source = `state: distinct matches of ${m.pattern} in the text files under ${m.paths.join(", ")}`;
  const found = sourceMatches(root, m.paths, m.pattern, m.ext);
  return { value: found.size, detail: [...found].map(([name, file]) => ({ label: `${name} (${file})`, value: 1, unit: "" })), source };
}

async function readRecords(m, { root }) {
  const what = m.share ? `the share with any of ${m.has_any.join(", ")}` : m.where ? `those whose ${m.where} is true` : "a count";
  const source = `state: the records of ${m.file}${m.path ? ` at ${m.path}` : ""}: ${what}`;
  let doc;
  try {
    doc = await readData(root, m.file);
  } catch (e) {
    return unread(firstLine(e), source);
  }
  const list = m.path ? String(m.path).split(".").reduce((o, k) => o?.[k], doc) : doc;
  if (!Array.isArray(list)) return unread(`${m.file}${m.path ? ` at ${m.path}` : ""} holds no list of records`, source);
  if (m.share) {
    if (!list.length) return unread(`${m.file} lists no record`, source);
    const has = list.map((r, i) => ({ label: recordName(r, i), value: m.has_any.some((f) => filled(r?.[f])) ? 1 : 0, unit: "" }));
    return { value: Math.round((has.reduce((s, d) => s + d.value, 0) / list.length) * 1000) / 10, detail: has, source };
  }
  if (m.where) {
    // No record with the field at all says the data does not mark it yet: no count, not a 0.
    if (!list.some((r) => r && typeof r === "object" && Object.hasOwn(r, m.where))) return unread(`not measured: no record carries a ${m.where} field yet`, source);
    const rows = list.map((r, i) => ({ label: recordName(r, i), value: r?.[m.where] === true ? 1 : 0, unit: "" }));
    return { value: rows.reduce((s, d) => s + d.value, 0), detail: rows, source: `${source}; ${list.length} records` };
  }
  return { value: list.length, source };
}

async function readFiles(m, { root }) {
  const ext = m.ext ?? TEXT_EXT;
  const source = `state: files in ${m.dir} ending ${ext.join(" or ")}`;
  const abs = resolve(root, m.dir);
  if (!existsSync(abs)) return m.absent_is_zero ? { value: 0, detail: [{ label: `${m.dir} is not in the repo yet`, value: 0 }], source } : unread(`${m.dir} is not in the repo`, source);
  const files = readdirSync(abs).filter((f) => ext.includes(extname(f)));
  return { value: files.length, detail: files.map((f) => ({ label: f, value: 1, unit: "" })), source };
}

async function readListings(m, { root }) {
  const source = "state: each listing as a file in the repo, or a manual flag with the day it was set";
  const rows = m.items.map((it) => {
    if (it.file) {
      const there = existsSync(resolve(root, it.file));
      return { label: `${it.label}: ${it.file} ${there ? "is" : "is not"} in the repo`, value: there ? 1 : 0, unit: "" };
    }
    return { label: `${it.label}: ${it.listed ? "listed" : "not listed"} (manual flag, set ${it.set})`, value: it.listed === true ? 1 : 0, unit: "" };
  });
  return { value: rows.reduce((s, d) => s + d.value, 0), detail: rows, source };
}

const hostDone = (host, done) => done.some((h) => host === h || host.endsWith(`.${h}`));

async function readRedirect(m, { site }) {
  const done = m.done_hosts ?? [];
  const source = `state: GET ${site.origin}${m.path}, following redirects on the site; a page on any host but the site and ${done.join(", ")} is one step`;
  let at = new URL(m.path, site.origin);
  const hops = [];
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res;
    try {
      res = await site.get(at.href);
    } catch (e) {
      return unread(`GET ${at.pathname}: ${firstLine(e)}`, source);
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    await res.body?.cancel?.();
    if (!location) {
      if (!res.ok) return unread(`GET ${at.pathname} answered ${res.status}`, source);
      return { value: 0, detail: [{ label: [...hops, `${at.pathname} on the site`].join(" then "), value: 0 }], source };
    }
    const next = new URL(location, at);
    hops.push(`${at.pathname} answers ${res.status}`);
    if (next.origin !== site.origin) {
      const steps = hostDone(next.hostname, done) ? 0 : 1;
      return { value: steps, detail: [{ label: [...hops, `${next.hostname}${steps ? ", a page on another site" : ""}`].join(" then "), value: steps }], source };
    }
    at = next;
  }
  return unread(`more than ${MAX_HOPS} redirects from ${m.path}`, source);
}

const READS = {
  marks: readMarks,
  pages: readPages,
  names: readNames,
  source: readSource,
  records: readRecords,
  files: readFiles,
  listings: readListings,
  redirect: readRedirect,
};
const ON_SITE = new Set(["marks", "pages", "names", "redirect"]);

// One metric's reading, from its own entry's params.measure.
async function readOne(def, ctx) {
  const m = def.params?.measure;
  if (!m || typeof m !== "object") return unread(`${def.id} has no params.measure in its targets entry`, OWN);
  if (m.read === "outside") return unread(m.reason || "a service this run cannot read", m.source || def.source || OWN);
  const read = READS[m.read];
  if (!read) return unread(`params.measure.read "${m.read}" is not one of ${[...Object.keys(READS), "outside"].join(", ")}`, OWN);
  if (ON_SITE.has(m.read) && !ctx.site.origin) return unread("params.origin names no site", def.source || OWN);
  try {
    const got = await read(m, ctx);
    if (got.could_not_check !== undefined) return got;
    return measured(got.value, got.source, got.detail, ctx.readAt);
  } catch (e) {
    return unread(firstLine(e), def.source || OWN);
  }
}

// Every metric of this targets file: { [id]: reading }. A test passes its own
// fetch, clock and retry wait.
export async function collect({ root = process.cwd(), params = {}, targets = [], fetch: fetchImpl = globalThis.fetch, now = new Date(), retryMs = RETRY_MS } = {}) {
  const ctx = { root, params, site: siteFor(params, fetchImpl, retryMs), readAt: now.toISOString() };
  const out = {};
  for (const def of targets) out[def.id] = await readOne(def, ctx);
  return out;
}

// Run alone: the targets file's entries and their params, merged as the engine merges them.
async function main(file) {
  if (!file) {
    console.error("usage: node quality/collectors/engagement/engagement.mjs <targets file>");
    process.exit(2);
  }
  const targets = JSON.parse(readFileSync(file, "utf8"));
  const params = Object.assign({}, ...targets.map((t) => t.params ?? {}));
  console.log(JSON.stringify(await collect({ root: process.cwd(), params, targets }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
