import { expect, test } from "@playwright/test";

// A test run is not a visit (#66). Before this spec, 85% of the page views
// Cloudflare Web Analytics recorded in a week came from these runs, on host
// 127.0.0.1, and /get-involved/apply/ alone took 1,428 of them. The test
// server (scripts/serve-dist.mjs) now sends each page without the beacon tag.

for (const path of ["/", "/get-involved/apply/", "/ask/"]) {
  test(`${path} sends nothing to Cloudflare Web Analytics from a test run`, async ({ page }) => {
    const hits: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (host === "cloudflareinsights.com" || host.endsWith(".cloudflareinsights.com")) hits.push(request.url());
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(hits).toEqual([]);
  });
}
