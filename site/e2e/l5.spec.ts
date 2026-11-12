import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { parse } from "yaml";

// L5: the Communitas welcome desk in a real browser, against the built site.
// It must work with JavaScript off, by keyboard, and pass axe (color contrast
// included, which jsdom cannot check).

const DESK = ".welcome-desk";

// Door labels come from routes.yaml, so a copy edit there cannot leave these
// locators looking for a door that no longer exists.
const routes = parse(readFileSync(new URL("../../data/communitas/routes.yaml", import.meta.url), "utf8")) as {
  id: string;
  label: string;
}[];
function doorLabel(id: string): string {
  const label = routes.find((r) => r.id === id)?.label;
  if (!label) throw new Error(`data/communitas/routes.yaml has no door "${id}"`);
  return label;
}
const IDEA = doorLabel("idea");
const INVESTING = doorLabel("investing");

test.describe("welcome desk", () => {
  test("opening a door shows its steps, and opening another closes the first", async ({ page }) => {
    await page.goto("/");
    const desk = page.locator(DESK);
    const idea = desk.locator("details", { has: page.getByText(IDEA, { exact: true }) });
    const investing = desk.locator("details", { has: page.getByText(INVESTING, { exact: true }) });

    await idea.locator("summary").click();
    await expect(idea).toHaveAttribute("open", "");
    await expect(idea.getByRole("link").first()).toBeVisible();

    await investing.locator("summary").click();
    await expect(investing).toHaveAttribute("open", "");
    await expect(idea).not.toHaveAttribute("open", "");
  });

  test("investors are never pointed at the Leaderboard", async ({ page }) => {
    await page.goto("/");
    const investing = page.locator(DESK).locator("details", { has: page.getByText(INVESTING, { exact: true }) });
    await investing.locator("summary").click();
    const hrefs = await investing.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).not.toContain("/leaderboard/");
  });

  test("works by keyboard", async ({ page }) => {
    await page.goto("/");
    const summary = page.locator(`${DESK} summary`).first();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`${DESK} details`).first()).toHaveAttribute("open", "");
  });

  test("passes axe, color contrast included", async ({ page }) => {
    await page.goto("/");
    // Open every door so axe sees the steps too.
    for (const summary of await page.locator(`${DESK} summary`).all()) await summary.click();
    const results = await new AxeBuilder({ page }).include(DESK).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("welcome desk without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("still opens doors and shows steps", async ({ page }) => {
    await page.goto("/");
    const door = page.locator(`${DESK} details`).first();
    await door.locator("summary").click();
    await expect(door).toHaveAttribute("open", "");
    await expect(door.getByRole("link").first()).toBeVisible();
  });
});
