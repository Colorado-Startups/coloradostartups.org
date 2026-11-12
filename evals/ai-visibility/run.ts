// Entry point for the AI-visibility panel. Node runs this TypeScript file
// directly (type stripping), so there is no build step. Flags: see cli.ts.
//
//   npm run eval:ai-visibility                                 dry run, sends nothing
//   npm run eval:ai-visibility -- --live --confirm-spend       spends money

import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { main } from "./cli.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

try {
  process.exitCode = await main(process.argv.slice(2), {
    root,
    env: process.env,
    fetch: globalThis.fetch,
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    log: (line) => console.log(line),
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  // 3: could not run, the same infrastructure code the repo's gates use.
  process.exitCode = 3;
}
