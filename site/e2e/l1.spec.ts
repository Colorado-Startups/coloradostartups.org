import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// L1: the Hall front (home, Community, Links, Founders) in a real browser,
// against the built site. axe runs with color contrast on, which jsdom cannot
// check, at a desktop width and at 375 px.

const PAGES = ["/", "/community/", "/links/", "/founders/"];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "375 px", width: 375, height: 812 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of PAGES) {
      test(`${route} passes axe, color contrast included`, async ({ page }) => {
        await page.goto(route);
        // The Turnstile iframe is third-party and not loaded offline (as in l2.spec.ts).
        const results = await new AxeBuilder({ page }).exclude(".cf-turnstile").analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
      });

      test(`${route} never scrolls sideways`, async ({ page }) => {
        await page.goto(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

// #128: one click on "Join the Slack" opens the Google Form, through the
// /slack/ short link. scripts/serve-dist.mjs does not apply _redirects, so the
// test reads the rule the build shipped instead of following it.
test("the home page's Join the Slack opens /slack/, which _redirects sends to the Google Form", async ({ page }) => {
  await page.goto("/");
  const join = page.locator("main").getByRole("link", { name: "Join the Slack" }).first();
  await expect(join).toHaveAttribute("href", "/slack/");
  const rules = readFileSync(new URL("../dist/_redirects", import.meta.url), "utf8");
  expect(rules).toMatch(/^\/slack\/ https:\/\/docs\.google\.com\/forms\/\S+ 302$/m);
});

test("the founders page has no form at all", async ({ page }) => {
  await page.goto("/founders/");
  await expect(page.locator("form, input, textarea, select")).toHaveCount(0);
});
