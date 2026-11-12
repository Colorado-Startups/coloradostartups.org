#!/usr/bin/env node
// The offline link checker, for a person at a terminal. Never run by a Worker:
// no Worker ever fetches a URL a user supplied (brief section 2.12).
//
//   node scripts/canvas/check-links.mjs https://acme.example/ [more URLs]
//       Checks links someone suggested, before a data PR (runbook
//       ops/runbooks/promote-submissions.md).
//   node scripts/canvas/check-links.mjs --records
//       Checks every record in data/resources/ and lists the ones that need a
//       look. It changes no file: a person decides what to do with each.
//
// Exit codes: 0 every link answered, 1 at least one dead, TLS or moved link,
// 2 usage error. Could-not-verify answers (403, timeouts) are listed but do
// not fail the run.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { readRecords } from "./lib/corpus.mjs";
import { checkUrls } from "./lib/links.mjs";
import { hostOf, siteOf } from "./lib/url.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "../../data/resources");

/** One line per link that needs a look, and whether any of them fails the run. */
export function summarize(results, labels = {}) {
  const lines = [];
  let failing = false;
  for (const r of Object.values(results)) {
    const label = labels[r.url] ? `${labels[r.url]}: ` : "";
    const moved = r.outcome === "ok" && r.finalUrl && siteOf(r.finalUrl) !== siteOf(r.url);
    if (r.outcome === "ok" && !moved) continue;
    const what = moved ? `moved to ${hostOf(r.finalUrl)}` : `${r.outcome} (${r.error ?? `HTTP ${r.status}`})`;
    if (r.outcome !== "unverified") failing = true;
    lines.push(`${label}${what}  ${r.url}`);
  }
  return { lines: lines.sort(), failing };
}

/**
 * @param {string[]} argv
 * @param {{ fetchImpl?: any, dataDir?: string, log?: (s: string) => void }} [deps]
 */
export async function main(argv, deps = {}) {
  const log = deps.log ?? ((s) => console.log(s));
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { records: { type: "boolean", default: false } } });
  } catch (err) {
    console.error(`usage error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.records === positionals.length > 0) {
    console.error("usage: node scripts/canvas/check-links.mjs (--records | URL [URL ...])");
    return 2;
  }
  const labels = {};
  let urls = positionals;
  if (values.records) {
    const records = readRecords(deps.dataDir ?? DATA);
    for (const r of records) labels[r.url] = r.id;
    urls = records.map((r) => r.url);
  }
  for (const u of urls) {
    if (!/^https?:\/\//i.test(u)) {
      console.error(`not an http(s) link: ${u}`);
      return 2;
    }
  }
  const results = await checkUrls([...new Set(urls)], { fetchImpl: deps.fetchImpl });
  const { lines, failing } = summarize(results, labels);
  log(`checked ${Object.keys(results).length} links; ${lines.length} need a look`);
  for (const line of lines) log(`  ${line}`);
  return failing ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.stack : err);
      process.exit(1);
    },
  );
}
