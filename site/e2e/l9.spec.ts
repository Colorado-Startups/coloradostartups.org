// L9: Team, Get involved and Dispatches in a real browser against the built
// site. Full axe (color contrast included, which jsdom cannot check) at
// desktop width and at 375 px, and no sideways scroll on a phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/team/", "/get-involved/", "/dispatches/"];

for (const width of [1280, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of PAGES) {
      test(`${path} passes axe and fits the screen`, async ({ page }) => {
        await page.goto(path);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("/team/", () => {
  test("shows every keeper with its disclosure", async ({ page }) => {
    await page.goto("/team/");
    const cards = page.locator("[data-keeper]");
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      await expect(card.locator("[data-disclosure]")).toBeVisible();
      await expect(card.locator("[data-disclosure]")).toContainText("AI agent run by Colorado Startups");
    }
  });

  test("links to the open positions", async ({ page }) => {
    await page.goto("/team/");
    await page.getByRole("link", { name: "See the open positions" }).first().click();
    await expect(page).toHaveURL(/\/get-involved\/$/);
  });
});

test.describe("/get-involved/", () => {
  test("names the seat in each seat email link", async ({ page }) => {
    await page.goto("/get-involved/");
    const link = page.getByRole("link", { name: "Email us about this seat (LinkedIn Group moderator)" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      /^mailto:info@coloradostartups\.org\?subject=Raise%20my%20hand%3A%20LinkedIn%20Group%20moderator/,
    );
  });

  test("sends a seat that takes applications to the form (L19)", async ({ page }) => {
    await page.goto("/get-involved/");
    const link = page.getByRole("link", { name: "Apply for this seat (Slack Community Lead)" });
    await expect(link).toHaveAttribute("href", "/get-involved/apply/?role=slack-community-lead");
  });
});

test.describe("/dispatches/", () => {
  test("opens a dispatch from the log", async ({ page }) => {
    await page.goto("/dispatches/");
    await page.locator("[data-dispatch] h3 a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "All dispatches" })).toHaveAttribute("href", "/dispatches/");
  });
});
