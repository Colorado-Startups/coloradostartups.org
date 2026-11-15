// The home page's Ask box sends its words to /ask/ as ?q=, and /ask/ puts them
// in Pagefind's search box and searches (ask.astro). Pagefind's index comes
// from the build, so this runs against the built site.
import { expect, test } from "@playwright/test";

test("/ask/?q= fills Pagefind's search box with the words", async ({ page }) => {
  await page.goto("/ask/?q=accelerator");
  await expect(page.locator("[data-ask-search] pagefind-input input")).toHaveValue("accelerator", { timeout: 15_000 });
});

test("the home page's Ask box opens /ask/ with the words", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Search resources, companies, guides and events").fill("accelerator");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/ask\/\?q=accelerator$/);
});
