// L29b in a real browser against the built site. With JavaScript off, the
// badge kit's copy buttons stay hidden: `.btn` sets display, so only the
// `.kit-copy .btn[hidden]` rule in BadgeCard.astro keeps them out of sight.
// With JavaScript on, the script shows them. The Leaderboard links to the kit.
import { expect, test } from "@playwright/test";

const KIT = "/leaderboard/kit/";

test.describe(`${KIT} without JavaScript`, () => {
  test.use({ javaScriptEnabled: false });

  test("shows no copy button, and still shows each snippet and its files", async ({ page }) => {
    await page.goto(KIT);
    const buttons = page.locator(".kit-copy button[data-copy]");
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) {
      await expect(button).toBeHidden();
      expect(await button.evaluate((el) => getComputedStyle(el).display)).toBe("none");
    }
    await expect(page.getByLabel("HTML to copy")).toHaveCount(2);
    for (const field of await page.getByLabel("HTML to copy").all()) await expect(field).toBeVisible();
    await expect(page.getByRole("link", { name: "Download the SVG" })).toHaveCount(2);
  });
});

test.describe(`${KIT} with JavaScript`, () => {
  test("shows each copy button once the script runs", async ({ page }) => {
    await page.goto(KIT);
    const buttons = page.getByRole("button", { name: "Copy the HTML" });
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) await expect(button).toBeVisible();
  });
});

test("/leaderboard/ links to the badge kit under the edition summary", async ({ page }) => {
  await page.goto("/leaderboard/");
  const link = page.getByRole("link", { name: "Listed here? Get the honoree badge for your site." });
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/leaderboard\/kit\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
