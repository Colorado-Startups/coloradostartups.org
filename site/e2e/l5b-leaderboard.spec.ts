import { expect, test } from "@playwright/test";

// L5b: the Leaderboard's honorees on a phone, and the filter (#145). On
// 2026-11-02 the table was 709 px wide inside a 327 px scroll box at 375 px.

test.describe("/leaderboard/ honorees at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("draws each row as a card that fits the screen, with each fact labeled", async ({ page }) => {
    await page.goto("/leaderboard/");
    const scroll = page.locator("[data-sortable-table] .scroll");
    const [scrollWidth, clientWidth] = await scroll.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const first = page.locator("[data-sortable-table] tbody tr").first();
    for (const label of ["Sector:", "HQ city:", "Boards:", "Sources:"]) {
      await expect(first.locator(".cell-label", { hasText: label })).toBeVisible();
    }
  });
});

test.describe("/leaderboard/ honorees filter", () => {
  test("narrows the rows by sector, says how many show, and clears", async ({ page }) => {
    await page.goto("/leaderboard/");
    const form = page.getByRole("search", { name: "Filter the honorees" });
    await expect(form).toBeVisible();
    const rows = page.locator("[data-sortable-table] tbody tr");
    const shown = page.locator("[data-sortable-table] tbody tr:visible");
    const total = await rows.count();

    const sector = form.getByLabel("Sector");
    const value = await sector.locator("option").nth(1).getAttribute("value");
    await sector.selectOption(value!);
    const expected = await page.locator(`[data-sortable-table] tbody tr[data-sector="${value}"]`).count();
    await expect(shown).toHaveCount(expected);
    expect(expected).toBeLessThan(total);
    await expect(page.locator("[data-sort-status]")).toHaveText(`Showing ${expected} of ${total} companies.`);

    await form.getByRole("button", { name: "Clear filters" }).click();
    await expect(shown).toHaveCount(total);
    await expect(page.locator("[data-sort-status]")).toHaveText(`Showing all ${total} companies.`);
  });

  test("finds a company by a word from its name", async ({ page }) => {
    await page.goto("/leaderboard/");
    const name = (await page.locator("[data-sortable-table] tbody th a").first().textContent())!.trim();
    await page.getByRole("search", { name: "Filter the honorees" }).getByLabel("Search").fill(name);
    await expect(page.locator("[data-sortable-table] tbody tr", { hasText: name }).first()).toBeVisible();
    await expect(page.locator("[data-sort-status]")).toHaveText(/^Showing \d+ of \d+ companies\.$/);
  });
});
