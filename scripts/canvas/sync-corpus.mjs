#!/usr/bin/env node
// Syncs data/resources/ into an AI Search instance's built-in storage, the
// corpus Resourcus searches. One markdown document per active resource,
// upserted by content hash; orphans deleted (lib/corpus.mjs has the contract).
//
//   node scripts/canvas/sync-corpus.mjs <instance> --dry-run
//   node scripts/canvas/sync-corpus.mjs <instance>
//
// <instance> is the AI Search instance name: "resourcus-staging" for staging,
// "resourcus" for production (site/wrangler.jsonc). Options:
//   --dry-run          plan only; makes no write call. With credentials it
//                      reads the instance's item list to diff against;
//                      without them it diffs against an empty instance.
//   --remote FILE      diff against a saved item list (JSON array) instead
//   --out DIR          also write each document to DIR for inspection
//   --namespace NAME   AI Search namespace (default "default")
//
// Credentials come from the environment and nowhere else:
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (AI Search Edit and Run).
// Paul runs the real sync in his own terminal. It refuses to write when CI is
// set, because CI never holds Paul's token.
//
// Exit codes: 0 done (or planned), 1 a write failed, 2 usage error, 3 could
// not check (records unreadable, or the item list could not be read).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { buildDocuments, planSync, readRecords } from "./lib/corpus.mjs";
import { INSTANCE_RE, itemsClient } from "./lib/items-api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function usage(msg) {
  if (msg) console.error(`usage error: ${msg}`);
  console.error("usage: node scripts/canvas/sync-corpus.mjs <instance> [--dry-run] [--remote FILE] [--out DIR] [--namespace NAME]");
  return 2;
}

const errText = (err) => (err instanceof Error ? err.message : String(err));

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, dataDir?: string, log?: (s: string) => void }} [deps]
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((s) => console.log(s));
  const cli = parseCli(argv, env);
  if (typeof cli === "number") return cli;
  const docs = loadDocs(deps.dataDir, cli.args.out, log);
  if (typeof docs === "number") return docs;
  const client = connect(env, cli, deps.fetchImpl);
  if (typeof client === "number") return client;

  let read;
  try {
    read = await readRemote(cli.args.remote, client, cli.instance);
  } catch (err) {
    console.error(`could not read the item list: ${errText(err)}`);
    return 3;
  }

  const plan = planSync(docs, read.remote);
  log(planLine(cli.dryRun, docs.length, read.against, plan));
  return cli.dryRun || !client ? 0 : applyPlan(client, plan, log);
}

/** The parsed options, instance and mode; or the exit code for a usage error or a write from CI. */
function parseCli(argv, env) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean", default: false },
        remote: { type: "string" },
        out: { type: "string" },
        namespace: { type: "string", default: "default" },
      },
      strict: true,
    });
  } catch (err) {
    return usage(errText(err));
  }
  const { values: args, positionals } = parsed;
  const instance = positionals[0];
  if (!instance || positionals.length > 1) return usage("give exactly one instance name");
  if (!INSTANCE_RE.test(instance)) return usage(`instance name ${JSON.stringify(instance)} is not valid`);
  const dryRun = args["dry-run"];
  if (!dryRun && args.remote) return usage("--remote only works with --dry-run");
  if (!dryRun && env.CI) {
    console.error("refusing to write from CI: the real sync runs in Paul's terminal with his token");
    return 2;
  }
  return { args, instance, dryRun };
}

/** The documents from data/resources/, also written to `out` for --out; exit 3 when the records cannot be read. */
function loadDocs(dataDir, out, log) {
  let docs;
  try {
    docs = buildDocuments(readRecords(dataDir ?? path.join(ROOT, "data/resources")));
  } catch (err) {
    console.error(`could not read the records: ${errText(err)}`);
    return 3;
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const d of docs) writeFileSync(path.join(out, d.key), d.text);
    log(`wrote ${docs.length} documents to ${out}`);
  }
  return docs;
}

/** The items client when credentials are set; null for a dry run without them; exit 2 for a real sync without them. */
function connect(env, { args, instance, dryRun }, fetchImpl) {
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) return clientFor(env, args.namespace, instance, fetchImpl);
  if (dryRun) return null;
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set for a real sync");
  return 2;
}

/** The one-line plan a run prints before it writes anything. */
const planLine = (dryRun, n, against, plan) =>
  `${dryRun ? "dry run" : "sync"} of ${n} active resources against ${against}: ` +
  `${plan.upload.length} to upload, ${plan.remove.length} to delete, ${plan.retry.length} to retry, ` +
  `${plan.unchanged} unchanged, ${plan.ignored} items without our prefix left alone`;

/** The AI Search items client, from the environment's credentials. */
function clientFor(env, namespace, instance, fetchImpl) {
  return itemsClient({
    accountId: String(env.CLOUDFLARE_ACCOUNT_ID),
    token: String(env.CLOUDFLARE_API_TOKEN),
    namespace,
    instance,
    fetchImpl,
  });
}

/** The item list to diff against: a saved file, the instance's own list, or none. Throws when it cannot be read. */
async function readRemote(file, client, instance) {
  if (file) return { remote: JSON.parse(readFileSync(file, "utf8")), against: `the saved list in ${file}` };
  if (!client) return { remote: [], against: "an empty instance (no credentials set)" };
  const remote = await client.list();
  return { remote, against: `instance ${instance} (${remote.length} items)` };
}

/** Runs the plan: retries, uploads, then deletes. Exit 1 if a call fails; the next run picks up where it stopped. */
async function applyPlan(client, plan, log) {
  const warnings = new Map();
  try {
    for (const item of plan.retry) await client.remove(item.id);
    for (const d of plan.upload) {
      for (const w of await client.upload(d.key, d.text, d.metadata)) {
        const k = `${w.code}${w.field ? ` (${w.field})` : ""}`;
        warnings.set(k, (warnings.get(k) ?? 0) + 1);
      }
    }
    for (const item of plan.remove) await client.remove(item.id);
  } catch (err) {
    console.error(`sync stopped: ${errText(err)}`);
    console.error("Run it again; it picks up where it stopped, because unchanged documents are skipped.");
    return 1;
  }
  for (const [k, n] of warnings) log(`warning from the API on ${n} uploads: ${k}`);
  log(`done: uploaded ${plan.upload.length}, deleted ${plan.remove.length + plan.retry.length}`);
  return 0;
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
