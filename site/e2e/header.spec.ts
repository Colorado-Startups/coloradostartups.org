import { expect, test } from "@playwright/test";

// #424: the header is one row or the menu button, never a nav wrapped onto a
// second row. Below 1200 px the nav sits behind the menu button; from 1200 px
// every item and the Join the Slack button share one row with the logo.

const COLLAPSED = [881, 1024, 1130, 1199];
const OPEN = [1200, 1280, 1440];

for (const width of COLLAPSED) {
  test(`at ${width} px the nav sits behind the menu button`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".site-header .menu-toggle")).toBeVisible();
    await expect(page.locator("#site-nav")).toBeHidden();
  });
}

for (const width of OPEN) {
  test(`at ${width} px the header is one row`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".site-header .menu-toggle")).toBeHidden();
    const middles = await page
      .locator(".site-header .brand, #site-nav ul a, #site-nav .cta")
      .evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return Math.round(box.top + box.height / 2);
        }),
      );
    // Every item's middle sits within a few pixels of the logo's.
    for (const middle of middles)
      expect(Math.abs(middle - middles[0])).toBeLessThanOrEqual(6);
  });
}
