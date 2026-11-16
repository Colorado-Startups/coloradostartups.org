// W8, Pick your region: the header's region slot and its chooser, in a real
// browser against the built site. The pick lives in localStorage only.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const KEY = "cs-your-region";
const chooser = (page: Page) => page.getByRole("dialog", { name: "Pick your region" });
const slot = (page: Page) => page.locator(".site-header [data-your-region]");
const box = (page: Page) =>
  slot(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), width: Math.round(r.width) };
  });

test.use({ viewport: { width: 1440, height: 900 } });

test("picks a region from the keyboard, keeps it after a reload, and forgets it", async ({ page }) => {
  await page.goto("/");
  const open = slot(page).getByRole("button", { name: "Pick your region" });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(chooser(page)).toBeVisible();
  // Every region, the same kind of button, A to Z.
  await expect(chooser(page).locator("[data-region-pick]")).toHaveText([/Fusion Canyon/, /Photon Mountain/, /Space Peak/]);
  await expect(chooser(page).getByRole("button", { name: /Fusion Canyon/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chooser(page)).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await chooser(page).getByRole("button", { name: /Space Peak/ }).click();
  await expect(chooser(page)).toBeHidden();
  const mine = slot(page).getByRole("link", { name: "Your region: Space Peak" });
  await expect(mine).toHaveAttribute("href", "/regions/space-peak/");
  await expect(mine).toBeFocused();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("space-peak");

  await page.reload();
  await expect(slot(page).getByRole("link", { name: "Your region: Space Peak" })).toBeVisible();
  await slot(page).getByRole("button", { name: "Change your region" }).click();
  await expect(chooser(page).getByRole("button", { name: /Space Peak/ })).toHaveAttribute("aria-pressed", "true");
  await chooser(page).getByRole("button", { name: "Forget my region" }).click();
  await expect(slot(page).getByRole("button", { name: "Pick your region" })).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

for (const width of [1200, 1440]) {
  test(`at ${width} px a restored pick keeps the header one row and the slot's box`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(slot(page).getByRole("button", { name: "Pick your region" })).toBeVisible();
    const empty = await box(page);

    await page.evaluate((k) => localStorage.setItem(k, "photon-mountain"), KEY);
    await page.reload();
    await expect(slot(page).getByRole("link", { name: "Your region: Photon Mountain" })).toBeVisible();
    expect(await box(page)).toEqual(empty);
    const middles = await page
      .locator(".site-header .brand, #site-nav ul a, #site-nav .cta, .site-header [data-region-page]")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)));
    for (const middle of middles) expect(Math.abs(middle - middles[0]!)).toBeLessThanOrEqual(6);
  });
}

test("in the phone menu, Escape closes the chooser and the menu stays open", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await slot(page).getByRole("button", { name: "Pick your region" }).click();
  await expect(chooser(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
});

test("works when storage throws: no pick, and the chooser still opens", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await slot(page).getByRole("button", { name: "Pick your region" }).click();
  await expect(chooser(page)).toBeVisible();
});

test("the open chooser passes axe", async ({ page }) => {
  await page.goto("/");
  await slot(page).getByRole("button", { name: "Pick your region" }).click();
  await expect(chooser(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).include(".region-chooser").analyze();
  expect(results.violations).toEqual([]);
});
