// K1, Ask anywhere: the header's Search button and the "/" key open the Ask
// dialog on every page. Runs against the built site.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Search or ask" });
const field = (page: Page) => dialog(page).getByLabel("Search the site");

test.use({ viewport: { width: 1440, height: 900 } });

for (const route of ["/", "/regions/", "/founders/", "/privacy/"]) {
  test(`on ${route}, / opens the dialog with the search field focused`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator(".site-header [data-ask-open]")).toBeVisible();
    await page.keyboard.press("/");
    await expect(dialog(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
  });
}

test("typing / in the search field types it and keeps one dialog", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("/");
  await field(page).pressSequentially("a/b");
  await expect(field(page)).toHaveValue("a/b");
  await expect(page.locator("dialog")).toHaveCount(1);
});

test("Escape closes the dialog and puts focus back where it was", async ({ page }) => {
  await page.goto("/");
  const brand = page.locator(".site-header .brand");
  await brand.focus();
  await page.keyboard.press("/");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(brand).toBeFocused();

  await page.locator(".site-header [data-ask-open]").click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".site-header [data-ask-open]")).toBeFocused();
});

test("submitting the search goes to /ask/?q=", async ({ page }) => {
  await page.goto("/regions/");
  await page.keyboard.press("/");
  await field(page).fill("accelerator");
  await field(page).press("Enter");
  await expect(page).toHaveURL(/\/ask\/\?q=accelerator$/);
});

test("the dialog names Resourcus as an AI agent and holds the Ask-your-AI row", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("/");
  await expect(dialog(page).getByRole("link", { name: "Ask Resourcus, an AI agent" })).toHaveAttribute("href", "/ask/");
  await expect(dialog(page).getByRole("button", { name: "Copy prompt" })).toBeVisible();
});

test("a / with Ctrl held, or typed in a page's own field, leaves the dialog shut", async ({ page }) => {
  await page.goto("/ecosystem-canvas/");
  await page.keyboard.press("Control+/");
  await expect(dialog(page)).toHaveCount(0);
  const search = page.getByRole("searchbox").first();
  await search.press("/");
  await expect(dialog(page)).toHaveCount(0);
});

test("the phone menu still opens, and its Search button opens the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.locator(".site-header [data-ask-open]").click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  // The menu stays open: Escape belonged to the dialog.
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
});

test("the open dialog passes axe", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("/");
  await expect(dialog(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).include(".ask-dialog").analyze();
  expect(results.violations).toEqual([]);
});
