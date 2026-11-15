// The statewide map (components/map/ColoradoMap.astro) in a real browser, on
// /styleguide/: the build-time drawing is there with or without JavaScript,
// and where the browser has WebGL2 the live MapLibre map loads over it with
// its three zone names and no console error. CI's headless Chromium may lack
// WebGL2; then the live part is skipped and the drawing is what ships.
import { expect, test } from "@playwright/test";

const MAP = "#sg-colorado-map";

for (const width of [1280, 375]) {
  test(`/styleguide/ map at ${width} px: the drawing, then the live map where WebGL2 exists`, async ({ page }) => {
    // The Cloudflare Web Analytics beacon (BaseLayout) posts to cloudflareinsights.com,
    // which refuses a 127.0.0.1 origin; served empty here, so any console error left is the map's.
    await page.route("https://static.cloudflareinsights.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/styleguide/");
    const map = page.locator(MAP);
    await expect(map.locator(".colorado-map__drawing svg[role='img']")).toHaveCount(1);
    for (const name of ["Photon Mountain", "Fusion Canyon", "Space Peak"]) await expect(map.locator(".colorado-map__drawing")).toContainText(name);
    const webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
    test.skip(!webgl2, "no WebGL2 in this browser: the drawing is the map");
    await map.scrollIntoViewIfNeeded();
    await expect(map).toHaveClass(/is-live/, { timeout: 30_000 });
    await expect(map.locator("canvas")).toBeVisible();
    await expect(map.locator(".colorado-map__label")).toHaveCount(3);
    // Idle means the basemap tiles came in too; a blocked tile logs an error first.
    await expect(map).toHaveAttribute("data-map", "idle", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test("/styleguide/ map with no JavaScript is the whole drawing", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/styleguide/");
    const drawing = page.locator(`${MAP} .colorado-map__drawing`);
    await expect(drawing).toBeVisible();
    await expect(drawing.locator("path")).not.toHaveCount(0);
  } finally {
    await context.close();
  }
});

// A region page's map (ColoradoMap with `zone`): the drawing zoomed to the
// zone with its core cities named, then, where WebGL2 exists, the live map
// fitted to the same zone, with no zone names over it (the basemap names the
// towns) and no console error.
test("/regions/fusion-canyon/ map: zoomed to the zone, drawing then live map", async ({ page }) => {
  await page.route("https://static.cloudflareinsights.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/regions/fusion-canyon/");
  const map = page.locator("#region-map");
  await expect(map).toHaveAttribute("data-zone", "fusion-canyon");
  for (const city of ["Fort Collins", "Loveland", "Windsor", "Greeley"]) await expect(map.locator(".colorado-map__drawing")).toContainText(city);
  const webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
  test.skip(!webgl2, "no WebGL2 in this browser: the drawing is the map");
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveClass(/is-live/, { timeout: 30_000 });
  await expect(map.locator("canvas")).toBeVisible();
  await expect(map.locator(".colorado-map__label")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-map", "idle", { timeout: 30_000 });
  expect(errors).toEqual([]);
});
