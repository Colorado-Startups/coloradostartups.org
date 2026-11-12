import { expect, test } from "@playwright/test";

// Page polish lane, #420: standalone links carry the global .tap-target class
// (#418), so on a phone each is at least 44 px tall (--size-tap). Links inside
// a sentence stay inline; WCAG 2.2 SC 2.5.8 exempts them.

const STANDALONE = [
  { route: "/code-of-conduct/", selector: "nav.toc a", count: 4 },
  { route: "/contact/", selector: ".doors a", count: 6 },
  { route: "/get-involved/", selector: "ul.jump a", count: 3 },
  { route: "/get-involved/", selector: ".position p.meta a", count: 7 },
];

test.describe("standalone links at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const { route, selector, count } of STANDALONE) {
    test(`${route} ${selector} are 44 px tap targets`, async ({ page }) => {
      await page.goto(route);
      const heights = await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThanOrEqual(count);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    });
  }
});
