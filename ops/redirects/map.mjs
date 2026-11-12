// The redirect map is the one definition: ops/redirects/map.csv. This module
// reads it and renders site/public/_redirects from it. It also reads
// old-sitemap.txt, the paths the old Squarespace sitemap listed, and judges a
// live redirect walk. test.mjs and the unit parity test
// (site/test/unit/l6/redirects.test.ts) both use it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAP_PATH = fileURLToPath(new URL("./map.csv", import.meta.url));
export const OLD_SITEMAP_PATH = fileURLToPath(new URL("./old-sitemap.txt", import.meta.url));

// A new path is a site path, or an https:// link off the site. The only off-site
// rows send the Slack short links to the sign-up form (#128), so the form's URL
// lives in this map alone and the backend can change behind /slack/. They answer
// 302, not 301: a browser keeps a 301 for good, and would still open the old
// form after the backend moved.
export const isOffSite = (to) => to.startsWith("https://");
export const statusFor = (row) => (isOffSite(row.to) ? 302 : 301);

// Reasons may contain commas, so only the first two commas split a row.
export function parseMap(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header !== "old_path,new_path,reason") throw new Error(`unexpected header: ${header}`);
  return lines.map((line, i) => {
    const a = line.indexOf(",");
    const b = line.indexOf(",", a + 1);
    const row = { old: line.slice(0, a), to: line.slice(a + 1, b), reason: line.slice(b + 1) };
    const target = row.to.startsWith("/") || isOffSite(row.to);
    if (a < 0 || b < 0 || !row.old.startsWith("/") || !target || !row.reason) {
      throw new Error(`map.csv row ${i + 2} is malformed`);
    }
    return row;
  });
}

export function readMap(path = MAP_PATH) {
  return parseMap(readFileSync(path, "utf8"));
}

// The request paths one map row answers, each with its own static 301.
// Workers static assets match /a and /a/ as separate sources: the redirects
// doc's own example has the rule "/trailing /trailing/ 301". A moved page
// (/about -> /team/) answers both forms. A kept page (/contact -> /contact/)
// answers only /contact: a rule for /contact/ would send it to itself, and
// /contact/ is the page.
export function sourcePaths(row) {
  if (row.to === `${row.old}/`) return [row.old];
  return [row.old, `${row.old}/`];
}

// Rule lines that send a path to itself. A #fragment never reaches the
// server, so "/a/ /a/#top 301" loops as surely as "/a/ /a/ 301".
export function selfRedirects(text) {
  return text.split("\n").filter((line) => {
    const [source, destination] = line.trim().split(/\s+/);
    return !line.startsWith("#") && destination !== undefined && source === destination.split("#")[0];
  });
}

export function renderRedirects(rows) {
  const out = [
    "# Generated from ops/redirects/map.csv by ops/redirects/map.mjs. Do not edit by hand:",
    "# edit the map, then run `node ops/redirects/test.mjs --write`.",
    "# Old Squarespace paths and short links 301 to the new site. A moved page answers with and",
    "# without a trailing slash; a kept page answers only without one, so it never redirects to itself.",
    "# The Slack short links 302 to the sign-up form, so the form can move.",
  ];
  for (const row of rows) {
    for (const source of sourcePaths(row)) out.push(`${source} ${row.to} ${statusFor(row)}`);
  }
  return `${out.join("\n")}\n`;
}

// old-sitemap.txt: one site path per line. Blank lines and # comments are
// skipped.
export function parseSitemapList(text) {
  return text.split(/\r?\n/).flatMap((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return [];
    if (!line.startsWith("/") || /\s/.test(line)) throw new Error(`old-sitemap.txt line ${i + 1} is malformed`);
    return [line];
  });
}

export function readOldSitemap(path = OLD_SITEMAP_PATH) {
  return parseSitemapList(readFileSync(path, "utf8"));
}

// A live walk from an old URL is a list of hops, one { status, to } per
// response. `to` is the Location as a site path (with any #fragment), the full
// URL when it points at another origin, or "" when there is none.
export const MAX_REDIRECTS = 5;
// Every hop must be a 301, the code every _redirects rule here writes
// (old-sitemap.txt: "301s only"). A 302 or 307, such as html_handling's
// trailing-slash answer, is temporary and keeps the old URL indexed.
const PERMANENT = new Set([301]);

export const isRedirect = (status) => status >= 300 && status < 400;

// The walker follows a hop only when it is a 301 that stays on the site.
// test.mjs sends the Access service token with every request, so it must
// never follow a Location to another origin.
export const canFollow = (hop) => PERMANENT.has(hop.status) && hop.to.startsWith("/");

// Null when the walk reached a 200 through 301s only, else
// what is wrong. A clean walk that ends in a 404 says "target <page> answered
// 404", the shape site/test/live/smoke-lib.mjs reads as a page not shipped yet.
export function judgeChain(hops) {
  for (const { status, to } of hops) {
    if (!isRedirect(status)) continue;
    if (!PERMANENT.has(status)) return `${status} -> ${to || "(no Location)"} is not a 301`;
    if (!to) return `${status} has no Location`;
    if (!to.startsWith("/")) return `${status} -> ${to} leaves the site`;
  }
  const end = hops.at(-1);
  if (!end) return "no response";
  if (isRedirect(end.status)) return `more than ${MAX_REDIRECTS} redirects, a loop`;
  if (end.status === 200) return null;
  if (end.status === 404 && hops.length > 1) return `target ${hops.at(-2).to.split("#")[0]} answered 404`;
  return `answered ${end.status}, want 200`;
}
