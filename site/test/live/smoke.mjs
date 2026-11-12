#!/usr/bin/env node
// Live smoke test for the coloradostartups.org site Worker. Owner: L11.
// Built for staging; it also runs against production after the cutover.
//
// Run it from the repo root with plain Node. No npm script and no install step
// beyond the checkout itself; it imports only node: builtins and repo files:
//
//   node site/test/live/smoke.mjs https://coloradostartups-site-staging.coloradostartups.workers.dev
//
// Environment:
//   CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET  the Access service token for
//       staging (ops/runbooks/staging-bringup.md, step 8). Read from the
//       environment only, never from the command line, and never printed. The
//       runbook's step 10 fills them from the macOS keychain. With both set,
//       the script also checks that a request without them is refused.
//
//   node site/test/live/smoke.mjs --self-test
//       runs the judging rules on seeded good and bad samples, with no network.
//
// What it checks, in order:
//   1. Access refuses a request without the token (only when a token is set).
//   2. Every nav page and feed answers 200. A 404 is PENDING, not a failure,
//      because other lanes are still shipping pages.
//   3. The security headers on a static page and on an /api/ answer equal
//      site/public/_headers.
//   4. The 301 map, by running ops/redirects/test.mjs (its one definition).
//      It asserts each Location exactly, a #fragment included. A target
//      page that 404s is PENDING. A target that names a section (#id) must
//      find that id on its page; until the page ships it, that is PENDING.
//   5. Each form route and /api/ask reject a bad Turnstile token. Nothing gets
//      past Turnstile, so nothing is stored and no model runs.
//   6. Each of those routes answers an over-limit burst with its rate-limit
//      answer. Burst requests carry no fields, so they stop at the speed check
//      or the JSON schema, before Turnstile, D1, Kit or the model.
//
// After a run, your IP stays rate limited on those five routes for up to one
// period (60 s in site/wrangler.jsonc).
//
// Exit codes match the repo's gates: 0 clean, 1 a FAIL, 2 usage error,
// 3 could not check (unreachable, Access refused the token, a stale payload).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readMap } from "../../../ops/redirects/map.mjs";
import {
  ASK_ROUTE,
  exitCode,
  FORM_ROUTES,
  formOutcome,
  fragmentTargets,
  isAccessRedirect,
  judgeAnchor,
  judgeAccessGate,
  judgeAskToken,
  judgeBurst,
  judgeFormToken,
  judgeHeaders,
  judgePage,
  judgeRedirects,
  NAV_PAGES,
  parseHeadersFile,
  rateLimits,
  runSelfTest,
  tally,
} from "./smoke-lib.mjs";
import { parseJsonc } from "../jsonc.mjs";

const repoFile = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const HEADERS_FILE = repoFile("../../public/_headers");
const WRANGLER_FILE = repoFile("../../wrangler.jsonc");
const REDIRECT_TEST = repoFile("../../../ops/redirects/test.mjs");
const TIMEOUT_MS = 15_000;
// A burst sends up to this many times the route's limit before giving up.
const BURST_FACTOR = 3;

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node site/test/live/smoke.mjs <https base URL> | --self-test");
  process.exit(2);
}

function readSources() {
  const headers = parseHeadersFile(readFileSync(HEADERS_FILE, "utf8"));
  const wrangler = parseJsonc(readFileSync(WRANGLER_FILE, "utf8"));
  return { headers, wrangler };
}

const arg = process.argv[2];

if (arg === "--self-test") {
  const wrong = runSelfTest();
  try {
    const { headers, wrangler } = readSources();
    if (headers.length === 0) wrong.push("site/public/_headers has no /* block");
    for (const env of [undefined, "staging"]) {
      const limits = rateLimits(wrangler, env);
      for (const name of ["FORM_RATE_LIMIT", "ASK_RATE_LIMIT"]) {
        if (!(limits[name] > 0)) wrong.push(`site/wrangler.jsonc ${env ?? "top level"} has no ${name} limit`);
      }
    }
  } catch (err) {
    wrong.push(`could not read a source file: ${err instanceof Error ? err.message : err}`);
  }
  for (const line of wrong) console.log(`FAIL self-test: ${line}`);
  console.log(wrong.length ? `self-test: ${wrong.length} wrong` : "self-test: ok");
  process.exit(wrong.length ? 1 : 0);
}

if (!arg) usage();
let baseUrl;
try {
  baseUrl = new URL(arg);
} catch {
  usage(`not a URL: ${arg}`);
}
const local = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
if (baseUrl.protocol !== "https:" && !local) usage("the base URL must be https (http is allowed for localhost only)");
const base = baseUrl.origin;
// Staging hosts carry "-staging." in their name; everything else is production.
const envName = /-staging\./.test(baseUrl.hostname) ? "staging" : undefined;

const clientId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
if (Boolean(clientId) !== Boolean(clientSecret)) {
  usage("set both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET, or neither");
}
const accessHeaders = clientId ? { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret } : {};

let sources;
try {
  sources = readSources();
} catch (err) {
  console.error(`could not read site/public/_headers or site/wrangler.jsonc: ${err instanceof Error ? err.message : err}`);
  process.exit(3);
}

function send(path, { method = "GET", body, headers = {}, withAccess = true } = {}) {
  return fetch(new URL(path, base), {
    method,
    body,
    redirect: "manual",
    headers: { ...(withAccess ? accessHeaders : {}), ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function drain(res) {
  try {
    await res.body?.cancel();
  } catch {
    // Nothing to free.
  }
}

const results = [];
function record(r) {
  results.push(r);
  console.log(`${r.level.padEnd(7)} ${r.check}: ${r.detail}`);
}
const reason = (err) => (err instanceof Error ? err.message : String(err));

function finish(note) {
  console.log(tally(results));
  if (note) console.log(note);
  process.exit(exitCode(results));
}

console.log(`smoke: ${base}${envName ? " (staging limits)" : ""}${clientId ? ", with an Access token" : ""}`);

// 1. Access refuses a request without the token.
if (clientId) {
  try {
    const res = await send("/", { withAccess: false });
    await drain(res);
    record(judgeAccessGate(res.status, res.headers.get("location")));
  } catch (err) {
    record({ level: "CANNOT", check: "access: no token is refused", detail: reason(err) });
  }
}

// Preflight: if the site is unreachable or Access refuses the token, every
// later check would only repeat that, so stop here.
try {
  const res = await send("/");
  await drain(res);
  if (isAccessRedirect(res.status, res.headers.get("location"))) {
    record({
      level: "CANNOT",
      check: "access: the token gets through",
      detail: "Access refused the service token; check the Service Auth policy and the two variables",
    });
    finish();
  }
} catch (err) {
  record({ level: "CANNOT", check: "reach the site", detail: reason(err) });
  finish();
}

// 2. Pages and feeds.
for (const page of NAV_PAGES) {
  try {
    const res = await send(page.path);
    await drain(res);
    record(judgePage(page, res.status, res.headers.get("content-type"), res.headers.get("location")));
  } catch (err) {
    record({ level: "CANNOT", check: `page ${page.path}`, detail: reason(err) });
  }
}

// 3. Security headers: a static page (public/_headers) and a Worker answer
// (worker/lib/security-headers.ts). A GET on a POST route is a 405 that the
// Worker still decorates.
for (const [path, where] of [
  ["/", "static page"],
  ["/api/subscribe", "Worker answer"],
]) {
  try {
    const res = await send(path);
    await drain(res);
    for (const r of judgeHeaders(sources.headers, res.headers, where)) record(r);
  } catch (err) {
    record({ level: "CANNOT", check: `headers (${where})`, detail: reason(err) });
  }
}

// 4. The 301 map. The redirect test reads the Access token from the same
// environment variables.
{
  const run = spawnSync(process.execPath, [REDIRECT_TEST, base], {
    env: process.env,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (run.error) {
    record(judgeRedirects(3, [reason(run.error)]));
  } else {
    const lines = (run.stdout ?? "").split("\n").filter(Boolean);
    for (const line of lines) if (/^(FAIL|INFRA)/.test(line)) console.log(`        ${line}`);
    record(judgeRedirects(run.status ?? 3, lines));
  }
  for (const target of fragmentTargets(readMap())) {
    try {
      const res = await send(target.page);
      record(judgeAnchor(target, res.status, res.status === 200 ? await res.text() : null));
      if (res.status !== 200) await drain(res);
    } catch (err) {
      record({ level: "CANNOT", check: `anchor ${target.page}#${target.id}`, detail: reason(err) });
    }
  }
}

// 5. A bad Turnstile token is rejected.
const formHeaders = { "Content-Type": "application/x-www-form-urlencoded" };
for (const route of FORM_ROUTES) {
  try {
    const res = await send(route.path, {
      method: "POST",
      body: new URLSearchParams(route.fields(Date.now())),
      headers: formHeaders,
    });
    await drain(res);
    record(judgeFormToken(route, res.status, res.headers.get("location")));
  } catch (err) {
    record({ level: "CANNOT", check: `turnstile ${route.path}`, detail: reason(err) });
  }
}
try {
  const res = await send(ASK_ROUTE.path, {
    method: "POST",
    body: JSON.stringify(ASK_ROUTE.body()),
    headers: { "Content-Type": "application/json" },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON answer is judged on its status alone.
  }
  record(judgeAskToken(res.status, body));
} catch (err) {
  record({ level: "CANNOT", check: `turnstile ${ASK_ROUTE.path}`, detail: reason(err) });
}

// 6. Over-limit bursts. Limits come from site/wrangler.jsonc, their one definition.
const limits = rateLimits(sources.wrangler, envName);
const bursts = [
  ...FORM_ROUTES.map((route) => ({
    path: route.path,
    limiter: route.limiter,
    init: { method: "POST", body: "", headers: formHeaders },
    limited: (res) => formOutcome(res.status, res.headers.get("location")) === "ratelimit",
  })),
  {
    path: ASK_ROUTE.path,
    limiter: ASK_ROUTE.limiter,
    init: { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } },
    limited: (res) => res.status === 429,
  },
];
for (const burst of bursts) {
  const limit = limits[burst.limiter];
  if (!(limit > 0)) {
    record({ level: "CANNOT", check: `burst ${burst.path}`, detail: `no ${burst.limiter} limit in site/wrangler.jsonc` });
    continue;
  }
  const outcomes = [];
  for (let i = 0; i < limit * BURST_FACTOR; i++) {
    try {
      const res = await send(burst.path, burst.init);
      await drain(res);
      const hit = burst.limited(res);
      outcomes.push(hit ? "ratelimit" : `http-${res.status}`);
      if (hit) break;
    } catch {
      outcomes.push("infra");
      break;
    }
  }
  record(judgeBurst(burst.path, outcomes, limit));
}

finish("Your IP stays rate limited on the five routes for up to 60 s (the period in site/wrangler.jsonc).");
