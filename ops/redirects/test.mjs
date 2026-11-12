#!/usr/bin/env node
// Checks a deployed site against ops/redirects/map.csv and
// ops/redirects/old-sitemap.txt, or rewrites site/public/_redirects from the
// map.
//
//   node ops/redirects/test.mjs https://coloradostartups.org
//   node ops/redirects/test.mjs --write
//
// Two passes:
//   1. The map. For each source path a row answers (sourcePaths in map.mjs:
//      a moved page with and without a trailing slash, a kept page without
//      one), expects one 301 whose Location is the new path, then a 200 at
//      the new path. A new path may carry a #fragment: the Location must keep
//      it (Cloudflare's static-assets redirects doc says a destination "Can
//      include fragments"), and the 200 check fetches the page without it.
//      An off-site new path (the Slack sign-up form) expects a 302 instead,
//      must match the Location exactly and is never fetched, so the Access
//      token stays on this site.
//   2. The old sitemap. For each path the old Squarespace sitemap listed,
//      follows redirects on the site and fails on any redirect that is not a
//      301 (a 302 or 307 keeps the old URL indexed), on a loop, or on a final
//      status other than 200 (judgeChain in map.mjs).
//
// Exit 0 all pass, 1 any failure, 2 usage error, 3 could not reach the site
// or read old-sitemap.txt.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  canFollow,
  isOffSite,
  isRedirect,
  judgeChain,
  MAX_REDIRECTS,
  readMap,
  readOldSitemap,
  renderRedirects,
  sourcePaths,
  statusFor,
} from "./map.mjs";

const REDIRECTS = fileURLToPath(new URL("../../site/public/_redirects", import.meta.url));
const arg = process.argv[2];

if (arg === "--write") {
  writeFileSync(REDIRECTS, renderRedirects(readMap()));
  console.log("wrote site/public/_redirects");
  process.exit(0);
}
if (!arg || !/^https?:\/\//.test(arg)) {
  console.error("usage: node ops/redirects/test.mjs <base-url> | --write");
  process.exit(2);
}

const base = arg.replace(/\/$/, "");
const origin = new URL(base).origin;
// Staging sits behind Cloudflare Access. Pass a service token through the
// environment, never on the command line.
const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID) headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
if (process.env.CF_ACCESS_CLIENT_SECRET) headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;

let failures = 0;
let unreachable = 0;
for (const row of readMap()) {
  const { to } = row;
  for (const path of sourcePaths(row)) {
    try {
      const res = await fetch(`${base}${path}`, { redirect: "manual", headers });
      const loc = res.headers.get("location") ?? "";
      const located = loc ? new URL(loc, base) : null;
      const offSite = isOffSite(to);
      const target = !located ? "" : offSite ? located.href : `${located.pathname}${located.hash}`;
      const want = statusFor(row);
      if (res.status !== want || target !== to) {
        failures++;
        console.log(`FAIL ${path}: ${res.status} -> ${loc || "(no Location)"}, want ${want} -> ${to}`);
        continue;
      }
      if (offSite) {
        console.log(`ok   ${path} -> ${to} (off the site, not fetched)`);
        continue;
      }
      const landed = await fetch(`${base}${to.split("#")[0]}`, { redirect: "manual", headers });
      if (landed.status !== 200) {
        failures++;
        console.log(`FAIL ${path}: target ${to} answered ${landed.status}`);
      } else {
        console.log(`ok   ${path} -> ${to}`);
      }
    } catch (err) {
      unreachable++;
      console.log(`INFRA ${path}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// One { status, to } per response, following only 301s that stay on this
// origin, so the Access headers never go to another host.
async function walk(path) {
  const hops = [];
  let url = new URL(`${base}${path}`);
  for (;;) {
    const res = await fetch(url, { redirect: "manual", headers });
    const loc = res.headers.get("location");
    const next = loc ? new URL(loc, url) : null;
    const to = !next ? "" : next.origin === origin ? `${next.pathname}${next.hash}` : next.href;
    const hop = { status: res.status, to };
    hops.push(hop);
    if (!canFollow(hop) || hops.filter((h) => isRedirect(h.status)).length > MAX_REDIRECTS) return hops;
    url = next;
  }
}

const describe = (hops) => hops.map((h) => (isRedirect(h.status) ? `${h.status} ${h.to}` : `${h.status}`)).join(" -> ");

let oldPaths = [];
try {
  oldPaths = readOldSitemap();
} catch (err) {
  unreachable++;
  console.log(`INFRA old-sitemap.txt: ${err instanceof Error ? err.message : err}`);
}
for (const path of oldPaths) {
  try {
    const hops = await walk(path);
    const problem = judgeChain(hops);
    if (problem) {
      failures++;
      console.log(`FAIL ${path}: ${problem}`);
    } else {
      console.log(`ok   ${path} -> ${describe(hops)}`);
    }
  } catch (err) {
    unreachable++;
    console.log(`INFRA ${path}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`${failures} failed, ${unreachable} unreachable`);
process.exit(failures ? 1 : unreachable ? 3 : 0);
