import { describe, expect, it } from "vitest";

import { contentPages } from "./pages";

// Cloudflare Web Analytics counts visits without cookies (privacy.md, "Our site
// analytics set no cookies"). On launch night the edge's automatic injection did
// not reach the Worker's static assets, so BaseLayout carries the beacon itself.
// This test checks every built page carries it exactly once, with the site's
// token, so a dropped tag or a second copy (auto-install plus the tag) fails.
// Run `npm run build` first.

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
const SITE_TOKEN = "58c9c5c3a6b843ec87df6970cbbc0d97"; // gitleaks:allow, the public Web Analytics site tag (#767)

/** What is wrong with a page's analytics beacon; empty when there is exactly one, with the site token. */
export function beaconProblems(html: string, token: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const beacons = [...doc.querySelectorAll("script")].filter((s) => s.getAttribute("src") === BEACON_SRC);
  if (beacons.length !== 1) return [`expected one analytics beacon, found ${beacons.length}`];
  let config: { token?: string } = {};
  try {
    config = JSON.parse(beacons[0].getAttribute("data-cf-beacon") ?? "{}");
  } catch {
    return ["data-cf-beacon is not JSON"];
  }
  return config.token === token ? [] : [`beacon token is ${config.token ?? "missing"}`];
}

describe("beaconProblems", () => {
  const tag = (cfg: string) => `<script defer src="${BEACON_SRC}" data-cf-beacon='${cfg}'></script>`;

  it("passes one beacon with the site token (known clean)", () => {
    expect(beaconProblems(`<head>${tag(`{"token": "${SITE_TOKEN}"}`)}</head>`, SITE_TOKEN)).toEqual([]);
  });

  it("flags a missing beacon, a doubled beacon and a wrong token (known bad)", () => {
    expect(beaconProblems("<head></head>", SITE_TOKEN)).toEqual(["expected one analytics beacon, found 0"]);
    const one = tag(`{"token": "${SITE_TOKEN}"}`);
    expect(beaconProblems(`<head>${one}${one}</head>`, SITE_TOKEN)).toEqual(["expected one analytics beacon, found 2"]);
    expect(beaconProblems(`<head>${tag('{"token": "other"}')}</head>`, SITE_TOKEN)).toEqual(["beacon token is other"]);
  });
});

describe("the analytics beacon on every built page", () => {
  for (const page of contentPages()) {
    it(`${page.route} carries one beacon with the site token`, () => {
      expect(beaconProblems(page.html, SITE_TOKEN)).toEqual([]);
    });
  }
});
