#!/usr/bin/env node
// Entry point for the Resourcus eval: bundles cli.ts (TypeScript, imports the
// Worker's own resourcus/ modules and @cs/shared) with esbuild into a temp
// file, then runs it. Flags pass through; see cli.ts.
//
//   node evals/resourcus/run.mjs                 offline, no network
//   node evals/resourcus/run.mjs --live --write-report   needs wrangler login

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(tmpdir(), `resourcus-eval-${process.pid}.mjs`);

try {
  await build({
    entryPoints: [path.join(here, "cli.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: out,
    // wrangler is loaded at run time from the repo, only for --live.
    external: ["wrangler"],
    // Bundled CommonJS dependencies call require() for Node builtins.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: "error",
  });
  const { main } = await import(pathToFileURL(out).href);
  process.exitCode = await main(root, process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  // 3: could not run, the same infrastructure code the repo's gates use.
  process.exitCode = 3;
} finally {
  rmSync(out, { force: true });
}
