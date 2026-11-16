// L8: the /regions/ map and its legend. At 1280 px the region chips sit
// beside the map, and the map fits in one screen; on a phone they stack under
// it. Since step H (2026-11-15) the chips take the place of the old side
// column (#246). Each region page leads with its own map (step R1).
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

// Step R1 (Paul, 2026-11-16: "It should be the map and what's there"): on a
// region page the real map is in the first screen, beside the title on a
// laptop and right under the buttons on a phone, and the painting is far
// below it.
const REGION_PAGES = ["/regions/photon-mountain/", "/regions/space-peak/", "/regions/fusion-canyon/"];

test.describe("region pages at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const path of REGION_PAGES) {
    test(`${path} shows the map beside the title, in the first screen`, async ({ page }) => {
      await page.goto(path);
      const map = (await page.locator("#region-map .colorado-map__box").boundingBox())!;
      const title = (await page.locator("main h1").boundingBox())!;
      const here = (await page.locator("main #where").boundingBox())!;
      expect(map.x, "the map is right of the title").toBeGreaterThanOrEqual(title.x + title.width);
      expect(map.y, "the map starts in the first screen").toBeLessThan(800);
      expect(here.y, "What's here starts in the first screen").toBeLessThan(800);
      const painting = (await page.locator(".region-art__media").boundingBox())!;
      expect(painting.y, "the painting is below the first screen").toBeGreaterThan(800);
    });
  }
});

test.describe("region pages at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const path of REGION_PAGES) {
    test(`${path} puts the map right under the buttons, before the painting`, async ({ page }) => {
      await page.goto(path);
      const map = (await page.locator("#region-map .colorado-map__box").boundingBox())!;
      const slack = (await page.locator("main").getByRole("link", { name: "Join the Slack", exact: true }).first().boundingBox())!;
      const here = (await page.locator("main #where").boundingBox())!;
      expect(map.y, "the map follows the buttons").toBeGreaterThan(slack.y + slack.height);
      expect(map.y, "the map starts in the first screen").toBeLessThan(812);
      expect(here.y, "What's here follows the map").toBeGreaterThan(map.y + map.height - 1);
      const painting = (await page.locator(".region-art__media").boundingBox())!;
      expect(painting.y).toBeGreaterThan(here.y);
    });
  }
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
