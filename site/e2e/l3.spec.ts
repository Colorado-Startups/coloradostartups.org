// L3: Startup Resources (the Ecosystem Canvas directory) and the
// suggest-a-resource page, in a real browser against the built site. Per
// playwright.config.ts these specs never submit a form; the POST contract is
// in test/worker/l3/.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const visibleCards = (page: Page) => page.locator("[data-resource]:not([hidden])");

test.describe("/ecosystem-canvas/", () => {
  test("shows every stage, with the anchors other lanes link to", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    await expect(page.getByRole("heading", { level: 1, name: "Startup Resources" })).toBeVisible();
    for (const stage of ["idea", "launch", "growth", "support"]) {
      await expect(page.locator(`section#${stage}`)).toHaveCount(1);
    }
    const intro = page.getByRole("region", { name: "Startup Resources" });
    await expect(intro.getByRole("link", { name: "Founder Institute" })).toHaveAttribute("href", "https://fi.co/");
    await expect(page.getByRole("status")).toHaveText(/^Showing all \d+ resources\.$/);
  });

  test("filters by stage and type in place, and keeps the filters in the URL", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const total = await visibleCards(page).count();
    await page.getByLabel("Stage").selectOption("launch");
    await page.getByLabel("Type").selectOption("investor");
    await expect(page).toHaveURL(/\?stage=launch&type=investor$/);
    const shown = visibleCards(page);
    expect(await shown.count()).toBeGreaterThan(0);
    expect(await shown.count()).toBeLessThan(total);
    // Support sits alongside every level, so it shows under Launch too (#134).
    for (const el of await shown.all()) {
      await expect(el).toHaveAttribute("data-stage", /^(launch|support)$/);
      await expect(el).toHaveAttribute("data-type", "investor");
    }
    await expect(page.locator("section#growth")).toBeHidden();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByRole("status")).toHaveText(`Showing all ${total} resources.`);
  });

  test("opens with the filters a link carries", async ({ page }) => {
    await page.goto("/ecosystem-canvas/?stage=growth&city=Denver");
    await expect(page.getByLabel("Stage")).toHaveValue("growth");
    for (const el of await visibleCards(page).all()) await expect(el).toHaveAttribute("data-city", "Denver");
  });

  test("searches with Pagefind and treats several words as all of them", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    await page.getByLabel("Search").fill("coworking boulder");
    await expect(page.getByRole("status")).toHaveText(/^Showing \d+ of \d+ resources\.$/);
    const shown = visibleCards(page);
    expect(await shown.count()).toBeGreaterThan(0);
    for (const el of await shown.all()) await expect(el).toContainText(/coworking/i);
  });

  test("passes axe", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("/ecosystem-canvas/suggest/", () => {
  test("has the form, the honeypot out of sight, and a load stamp", async ({ page }) => {
    await page.goto("/ecosystem-canvas/suggest/");
    const form = page.locator("form[data-suggest-form]");
    await expect(form).toHaveAttribute("action", "/api/suggest-resource");
    await expect(page.getByLabel("Name of the resource")).toBeVisible();
    await expect(page.getByLabel("Link to its website")).toBeVisible();
    await expect(page.locator("#suggest-website")).not.toBeInViewport();
    await expect(page.locator('input[name="ts"]')).not.toHaveValue("");
  });

  test("shows the message for an error code, as text", async ({ page }) => {
    await page.goto("/ecosystem-canvas/suggest/?error=verification");
    await expect(page.getByRole("alert")).toHaveText(/could not confirm you are a person/);
    await page.goto("/ecosystem-canvas/suggest/?error=<img src=x onerror=alert(1)>");
    await expect(page.getByRole("alert")).toBeHidden();
  });

  test("passes axe", async ({ page }) => {
    await page.goto("/ecosystem-canvas/suggest/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
