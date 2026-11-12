// @ts-check
// Sitemap lastmod from each page's own data date (GO-LIVE item B8). Owner: L31.
//
// A page gets a lastmod only when its data carries a date. Every other page
// gets none. No page ever gets the build time, because a date that moves on
// every deploy tells a crawler nothing.
//
//   Page                 Date, from the data file
//   /dispatches/<id>/    `date` in data/dispatches/<id>.md
//   /dispatches/         the newest dispatch `date`
//   /privacy/            `updated` in data/legal/privacy.md
//   /leaderboard/        `published` of the newest edition in data/leaderboard/editions/
//
// astro.config.mjs imports this before content collections load, so it reads
// the data files directly. A missing file or a value that is not a date gives
// that page no lastmod; it never stops the build.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * The calendar day of a data value, as YYYY-MM-DD, or null.
 * Takes a date, or an ISO datetime whose leading day it keeps.
 * @param {unknown} v
 * @returns {string | null}
 */
export function calendarDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(v.trim());
  if (!m) return null;
  const day = /** @type {string} */ (m[1]);
  // A real day: 2026-02-30 does not survive the round trip.
  const t = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === day ? day : null;
}

/**
 * @param {string} file
 * @returns {string | null}
 */
function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * The YAML front matter of a Markdown file, or null.
 * @param {string | null} text
 * @returns {Record<string, unknown> | null}
 */
function frontMatter(text) {
  const m = text === null ? null : /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return m ? yamlRecord(m[1] ?? "") : null;
}

/**
 * @param {string | null} text
 * @returns {Record<string, unknown> | null}
 */
function yamlRecord(text) {
  if (text === null) return null;
  try {
    const v = parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function filesIn(dir, pattern) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => pattern.test(f))
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {string | null} a
 * @param {string | null} b
 */
function later(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return b > a ? b : a;
}

/** The repo's data/ folder, from site/src/lib/seo/. */
const DATA_DIR = fileURLToPath(new URL("../../../../data", import.meta.url));

/**
 * Every page path that has a data date, mapped to that date.
 * @param {string} [dataDir] the data/ folder; tests pass a fixture folder
 * @returns {Map<string, string>}
 */
export function dataDates(dataDir = DATA_DIR) {
  /** @type {Map<string, string>} */
  const dates = new Map();

  // The dispatch URL uses the file name without .md (pages/dispatches/[id].astro).
  const dispatchDir = path.join(dataDir, "dispatches");
  /** @type {string | null} */
  let newestDispatch = null;
  for (const f of filesIn(dispatchDir, /\.md$/)) {
    const day = calendarDate(frontMatter(readText(path.join(dispatchDir, f)))?.date);
    if (day === null) continue;
    dates.set(`/dispatches/${f.replace(/\.md$/, "")}/`, day);
    newestDispatch = later(newestDispatch, day);
  }
  if (newestDispatch !== null) dates.set("/dispatches/", newestDispatch);

  const privacy = calendarDate(frontMatter(readText(path.join(dataDir, "legal/privacy.md")))?.updated);
  if (privacy !== null) dates.set("/privacy/", privacy);

  // The Leaderboard shows the newest edition by `published` (lib/leaderboard/board.ts).
  const editionDir = path.join(dataDir, "leaderboard/editions");
  /** @type {string | null} */
  let newestEdition = null;
  for (const f of filesIn(editionDir, /\.ya?ml$/)) {
    newestEdition = later(newestEdition, calendarDate(yamlRecord(readText(path.join(editionDir, f)))?.published));
  }
  if (newestEdition !== null) dates.set("/leaderboard/", newestEdition);

  return dates;
}

/**
 * The @astrojs/sitemap serialize hook. A page with a data date gets that date
 * as lastmod. Every other page leaves with no lastmod at all.
 * @param {ReadonlyMap<string, string>} dates from dataDates()
 * @returns {(item: { url: string; lastmod?: string }) => { url: string; lastmod?: string }}
 */
export function lastmodSerializer(dates) {
  return (item) => {
    const { lastmod: _ignored, ...rest } = item;
    const day = dates.get(new URL(item.url).pathname);
    return day === undefined ? rest : { ...rest, lastmod: day };
  };
}
