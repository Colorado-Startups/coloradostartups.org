// L26: the badge kit in a real browser against the built site. Full axe
// (color contrast included, which jsdom cannot check) at desktop width and at
// 375 px, no sideways scroll on a phone, both badges load, and each copy
// button puts its snippet on the clipboard.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PATH = "/leaderboard/kit/";

for (const width of [1280, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`${PATH} passes axe, fits the screen and loads both badges`, async ({ page }) => {
      await page.goto(PATH);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const previews = page.locator(".kit-preview img");
      await expect(previews).toHaveCount(2);
      for (const img of await previews.all()) {
        await img.scrollIntoViewIfNeeded();
        expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      }
    });
  });
}

test.describe(PATH, () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies each badge's snippet when its button is pressed", async ({ page }) => {
    await page.goto(PATH);
    for (const id of ["leaderboard-2026-honoree", "startup-resources-listed"]) {
      const card = page.locator(`[data-kit-badge='${id}']`);
      await card.getByRole("button", { name: "Copy the HTML" }).click();
      await expect(card.getByRole("status")).toHaveText("Copied. Paste it into your site's HTML.");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(await card.getByLabel("HTML to copy").inputValue());
      expect(copied).toContain(`src="https://coloradostartups.org/badges/${id}.svg"`);
    }
  });
});
