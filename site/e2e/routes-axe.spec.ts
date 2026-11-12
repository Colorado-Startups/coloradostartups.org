// The page routes no other spec opened (the Tests tab's axe and e2e route
// metrics, read by Code-OS's tests collector): full axe, color contrast
// included, at desktop width and at 375 px, and no sideways scroll on a
// phone. One spec for all of them, one test per page and width, so the e2e
// shards stay as they are. A dynamic route opens one real page: the first
// dispatch and the first guide in GUIDE_SLUGS.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/data/",
  "/dispatches/2026-10-06-a-new-chapter/",
  "/ecosystem-canvas/suggest/thanks/",
  "/guides/",
  "/guides/start-a-company-in-colorado/",
  "/guides/startup-credits/",
  "/leaderboard/nominate/thanks/",
  "/styleguide/",
];

for (const width of [1280, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const route of PAGES) {
      test(`${route} passes axe and fits the screen`, async ({ page }) => {
        const response = await page.goto(route);
        expect(response?.status(), `${route} is a built page`).toBe(200);
        // The Turnstile iframe is third-party and not loaded offline (as in l1.spec.ts).
        const results = await new AxeBuilder({ page }).exclude(".cf-turnstile").analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
