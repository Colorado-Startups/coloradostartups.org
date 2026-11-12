#!/usr/bin/env node
// Regenerates workers/communitas/src/generated/library.json from the YAML
// sources listed in library.mjs. Run it from anywhere after editing
// data/communitas/*.yaml or data/team/dwarves.yaml:
//
//   node workers/communitas/scripts/sync-library.mjs           write the file
//   node workers/communitas/scripts/sync-library.mjs --check   exit 1 if stale
//
// Exit codes follow the repo's checker contract: 0 clean, 1 stale (--check),
// 2 usage error, 3 could not check (missing parser or unreadable source).

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLibrary, OUTPUT, renderLibrary, SOURCES } from "./library.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
if (args.some((a) => a !== "--check")) {
  console.error("usage: sync-library.mjs [--check]");
  process.exit(2);
}

let parse;
let sources;
try {
  // @cs/site declares the yaml package; resolve it from there on purpose.
  ({ parse } = createRequire(path.join(ROOT, "site/package.json"))("yaml"));
  sources = Object.fromEntries(
    Object.entries(SOURCES).map(([key, rel]) => [key, readFileSync(path.join(ROOT, rel), "utf8")]),
  );
} catch (err) {
  console.error(`sync-library: could not check (${err.message})`);
  process.exit(3);
}

const next = renderLibrary(buildLibrary(sources, parse));
const target = path.join(ROOT, OUTPUT);

if (args.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // A missing file is stale.
  }
  if (current !== next) {
    console.error(`sync-library: ${OUTPUT} is stale. Run: node workers/communitas/scripts/sync-library.mjs`);
    process.exit(1);
  }
  console.log(`sync-library: ${OUTPUT} is current`);
} else {
  writeFileSync(target, next);
  console.log(`sync-library: wrote ${OUTPUT}`);
}
