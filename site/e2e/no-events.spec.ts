import { expect, test } from "@playwright/test";

// A test run is not a visitor (#66, M1b). The e2e server serves the
// production build on 127.0.0.1, and src/lib/track.ts sends nothing on a local
// host. This spec proves it in a real browser: it marks a button the way M1c
// will, clicks it, and expects no request to /api/e.

for (const path of ["/", "/get-involved/apply/", "/ask/"]) {
  test(`${path} posts no event to /api/e from a test run`, async ({ page }) => {
    const hits: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/e") hits.push(request.url());
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    // The helper is on the page: its module script loaded.
    const scripts = await page.locator('script[type="module"][src^="/_astro/"]').count();
    expect(scripts).toBeGreaterThan(0);

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "e2e-track-probe";
      button.textContent = "Probe";
      button.setAttribute("data-track", "join_click");
      button.setAttribute("data-track-where", "e2e");
      document.body.append(button);
    });
    await page.locator("#e2e-track-probe").click();
    await page.waitForLoadState("networkidle");
    expect(hits).toEqual([]);
  });
}
