// L8: the /regions/ map and its legend. At 1280 px the region chips sit
// beside the map, and the map fits in one screen; on a phone they stack under
// it. Since step H (2026-11-15) the chips take the place of the old side
// column (#246).
import { expect, test } from "@playwright/test";

test.describe("/regions/ map and chips at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("puts the chips beside the map, and the map inside one screen", async ({ page }) => {
    await page.goto("/regions/");
    const map = (await page.locator("#regions-map .colorado-map__box").boundingBox())!;
    const chips = (await page.locator(".region-chips").boundingBox())!;
    expect(chips.x, "the chips start right of the map").toBeGreaterThanOrEqual(map.x + map.width);
    expect(chips.y).toBeLessThan(map.y + map.height);
    expect(map.height, "the map is no taller than the screen").toBeLessThanOrEqual(800);
  });
});

test.describe("/regions/ map and chips at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("stacks the chips under the map", async ({ page }) => {
    await page.goto("/regions/");
    const map = (await page.locator("#regions-map").boundingBox())!;
    const chips = (await page.locator(".region-chips").boundingBox())!;
    expect(chips.y).toBeGreaterThan(map.y + map.height - 1);
  });
});
