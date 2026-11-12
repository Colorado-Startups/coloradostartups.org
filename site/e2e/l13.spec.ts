import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// L13: the info pages in a real browser, against the built site. axe runs
// with color contrast (jsdom cannot check it), at desktop width and at 375 px.
// The calendar iframe is excluded from axe: Google's frame is not our markup.

const ROUTES = [
  "/newsletter/",
  "/newsletter/thanks/",
  "/event-calendar/",
  "/code-of-conduct/",
  "/contact/",
  "/privacy/",
  "/a-page-that-does-not-exist/",
];

const WIDTHS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 812 },
];

for (const size of WIDTHS) {
  test.describe(`info pages at ${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const route of ROUTES) {
      test(`${route} passes axe, color contrast included`, async ({ page }) => {
        await page.goto(route);
        const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });

      test(`${route} does not scroll sideways`, async ({ page }) => {
        await page.goto(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test("an unknown path answers 404 with the Hall's not-found page", async ({ page }) => {
  const response = await page.goto("/a-page-that-does-not-exist/");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This passage leads nowhere");
  await expect(page.getByRole("link", { name: "Browse Startup Resources" })).toHaveAttribute("href", "/ecosystem-canvas/");
});

test("the event calendar frame loads lazily and keeps its title", async ({ page }) => {
  await page.goto("/event-calendar/");
  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("loading", "lazy");
  await expect(frame).toHaveAttribute("title", /calendar/i);
});
