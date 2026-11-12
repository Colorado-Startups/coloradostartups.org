// L8: /regions/ keeps "How the regions work" and "Elsewhere in Colorado"
// beside the Front Range map while the map scrolls past at 1280 px, so its
// lower half no longer sits next to an empty block (#246). On a phone the
// column stacks under the map and nothing sticks.
import { expect, test } from "@playwright/test";

test.describe("/regions/ side column at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("stays in view beside the map's lower half", async ({ page }) => {
    await page.goto("/regions/");
    await page.evaluate(() => document.fonts.ready);
    const map = page.locator(".map-layout figure.chart");
    const side = page.locator(".map-layout .side");
    // Scroll until the bottom of the map sits at the bottom of the screen.
    const mapBottom = await map.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y - window.innerHeight), mapBottom);
    const box = await side.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(box.top, "the side column's top is on screen").toBeGreaterThanOrEqual(0);
    expect(box.bottom, "the side column's bottom is on screen").toBeLessThanOrEqual(800);
    await expect(page.getByRole("heading", { name: "How the regions work" })).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Elsewhere in Colorado" })).toBeInViewport();
  });
});

test.describe("/regions/ side column at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("stacks under the map and does not stick", async ({ page }) => {
    await page.goto("/regions/");
    const map = await page.locator(".map-layout figure.chart").boundingBox();
    const side = page.locator(".map-layout .side");
    const box = await side.boundingBox();
    expect(box!.y).toBeGreaterThan(map!.y + map!.height);
    expect(await side.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  });
});
