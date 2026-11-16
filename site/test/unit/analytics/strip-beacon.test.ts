import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BEACON_HOST, stripBeacon } from "../../../scripts/strip-beacon.mjs";

// A test run is not a visit (#66). In the 7 days to 2026-11-15, 85% of the
// page views Cloudflare Web Analytics recorded came from host 127.0.0.1: the
// e2e runs. The test server now sends every page without the beacon, and
// `astro dev` never renders it. The built files keep it for production
// (test/dom/analytics-beacon.test.ts).

const layout = readFileSync(resolve(__dirname, "../../../src/layouts/BaseLayout.astro"), "utf8");
const beacon = `<script defer src="https://${BEACON_HOST}/beacon.min.js" data-cf-beacon='{"token": "t"}'></script>`;
const other = `<script type="module" src="/_astro/page.js"></script>`;

describe("stripBeacon", () => {
  it("takes the beacon tag out and leaves every other script (known bad, then clean)", () => {
    expect(stripBeacon(`<head>${other}${beacon}</head>`)).toBe(`<head>${other}</head>`);
  });

  it("takes out a doubled tag too", () => {
    expect(stripBeacon(`<head>${beacon}${beacon}</head>`)).toBe("<head></head>");
  });

  it("leaves a page with no beacon as it is (known clean)", () => {
    const page = `<head>${other}</head><body><p>${BEACON_HOST}</p></body>`;
    expect(stripBeacon(page)).toBe(page);
  });
});

describe("the layout's beacon", () => {
  it("loads from the host the test server strips", () => {
    expect(layout).toContain(`src="https://${BEACON_HOST}/beacon.min.js"`);
  });

  it("renders only in a production build, so astro dev counts no visit", () => {
    const line = layout.split("\n").find((l: string) => l.includes(BEACON_HOST) && l.includes("<script"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\{import\.meta\.env\.PROD && <script\b/);
  });
});
