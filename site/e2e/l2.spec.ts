import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// L2 Leaderboard journeys against the built static site. Per playwright.config.ts
// these never submit the form; the POST contract lives in
// test/worker/l2/nominate.test.ts.

test.describe("/leaderboard/", () => {
  test("shows the edition as a table that sorts by column", async ({ page }) => {
    await page.goto("/leaderboard/");
    const table = page.locator("[data-sortable-table] table");
    await expect(table).toBeVisible();

    const names = async () => table.locator("tbody th[scope=row] a").allTextContents();
    const initial = await names();
    expect(initial.length).toBeGreaterThan(1);
    expect(initial).toEqual([...initial].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));

    const companyHeader = table.locator("thead th").first();
    await expect(companyHeader).toHaveAttribute("aria-sort", "ascending");
    await companyHeader.getByRole("button").click();
    await expect(companyHeader).toHaveAttribute("aria-sort", "descending");
    expect(await names()).toEqual([...initial].reverse());

    const cityHeader = table.locator("thead th", { hasText: "HQ city" });
    await cityHeader.getByRole("button").click();
    await expect(cityHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(companyHeader).not.toHaveAttribute("aria-sort", /.+/);
    await expect(page.locator("[data-sort-status]")).toHaveText(/Sorted by HQ city, ascending/);
  });

  // Every column looks sortable: the sorted one shows its direction, the
  // others a dim up and down arrow. The arrow stays out of the button's
  // accessible name, and hover underlines the label (#241).
  test("marks every sortable column and keeps the arrows out of the names", async ({ page }) => {
    await page.goto("/leaderboard/");
    const buttons = page.locator("[data-sortable-table] thead button");
    await expect(buttons).toHaveCount(4);
    const labels = ["Company", "Sector", "HQ city", "Boards"];
    for (const [i, label] of labels.entries()) await expect(buttons.nth(i)).toHaveAccessibleName(label);

    const arrows = () =>
      buttons.evaluateAll((els) => els.map((b) => getComputedStyle(b.querySelector(".sort-icon")!, "::after").content));
    expect(await arrows()).toEqual(['"▲"', '"↕"', '"↕"', '"↕"']);
    await buttons.nth(1).click();
    expect(await arrows()).toEqual(['"↕"', '"▲"', '"↕"', '"↕"']);
    await expect(buttons.nth(1)).toHaveAccessibleName("Sector");

    const decoration = () => buttons.nth(2).evaluate((b) => getComputedStyle(b).textDecorationLine);
    expect(await decoration()).toBe("none");
    await buttons.nth(2).hover();
    expect(await decoration()).toBe("underline");
  });

  test("gives every chart a text alternative and its data", async ({ page }) => {
    await page.goto("/leaderboard/");
    const figures = page.locator("figure.chart");
    await expect(figures).toHaveCount(3);
    for (const figure of await figures.all()) {
      // A phone version sits beside each chart, display: none at this width (#329).
      await expect(figure.locator("svg[aria-label]:visible")).toHaveCount(1);
      await expect(figure.locator("figcaption")).not.toBeEmpty();
      await figure.locator("details summary").click();
      expect(await figure.locator("details tbody tr").count()).toBeGreaterThan(0);
    }
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/leaderboard/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // Every visible chart label draws at 15 px or more: its computed size times
  // the SVG's shown width over its viewBox width (#329).
  for (const width of [360, 375, 1280]) {
    test.describe(`charts at ${width} px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("draw every label at 15 px or more", async ({ page }) => {
        await page.goto("/leaderboard/");
        const small = await page.locator("figure.chart svg[role=img]:visible").evaluateAll((svgs) =>
          svgs.flatMap((svg) => {
            const k = svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width;
            return [...svg.querySelectorAll("text")]
              .map((t) => ({ text: t.textContent, drawn: parseFloat(getComputedStyle(t).fontSize) * k }))
              .filter((t) => t.drawn < 14.95)
              .map((t) => `${t.text} ${t.drawn.toFixed(1)} px`);
          }),
        );
        expect(small).toEqual([]);
      });
    });
  }

  test.describe("at 375 px", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    // WCAG 2.2 SC 2.5.8: each source link is a 24 px target (#119).
    test("gives every source link a 24 px tall target", async ({ page }) => {
      await page.goto("/leaderboard/");
      const heights = await page
        .locator("[data-sortable-table] .sources a")
        .evaluateAll((links) => links.map((a) => a.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(0);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(24);
      const results = await new AxeBuilder({ page }).include("[data-sortable-table]").withRules(["target-size"]).analyze();
      expect(results.violations).toEqual([]);
    });

    // The sort buttons were 23 px tall here (#241); 44 px is the tap target goal.
    test("gives every sort button a 44 px tall target", async ({ page }) => {
      await page.goto("/leaderboard/");
      const heights = await page
        .locator("[data-sortable-table] thead button")
        .evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height));
      expect(heights).toHaveLength(4);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    });

    // The table scrolls inside its own box and adds nothing to the page's
    // width (#242). The page is measured with and without it, so the long
    // h1 (#237, global.css) does not fail this check.
    test("keeps the table's width inside its own scroll box", async ({ page }) => {
      await page.goto("/leaderboard/");
      const [withTable, withoutTable] = await page.evaluate(() => {
        const table = document.querySelector<HTMLElement>("[data-sortable-table]")!;
        const width = document.documentElement.scrollWidth;
        table.style.display = "none";
        return [width, document.documentElement.scrollWidth];
      });
      expect(withTable).toBe(withoutTable);
    });
  });
});

test.describe("/leaderboard/nominate/", () => {
  test("states the purpose limit before the form", async ({ page }) => {
    await page.goto("/leaderboard/nominate/");
    const purpose = page.locator("section.purpose");
    await expect(purpose).toContainText("only to verify and rank");
    await expect(purpose).toContainText("never use it for investment sourcing");
    await expect(purpose).toContainText("90 days");
    const purposeBox = await purpose.boundingBox();
    const formBox = await page.locator("form[data-nomination-form]").boundingBox();
    expect(purposeBox!.y).toBeLessThan(formBox!.y);
  });

  test("stamps the load time for the speed check", async ({ page }) => {
    await page.goto("/leaderboard/nominate/");
    const ts = Number(await page.locator("input[name=ts]").inputValue());
    expect(ts).toBeGreaterThan(Date.now() - 60_000);
  });

  test("shows the matching message for ?error= and nothing for unknown codes", async ({ page }) => {
    await page.goto("/leaderboard/nominate/?error=invalid");
    await expect(page.locator('[data-error="invalid"]')).toBeVisible();
    await expect(page.locator('[data-error="verification"]')).toBeHidden();

    await page.goto("/leaderboard/nominate/?error=<img>");
    await expect(page.locator("[data-error]:visible")).toHaveCount(0);
  });

  test("hides the honeypot from people", async ({ page }) => {
    await page.goto("/leaderboard/nominate/");
    await expect(page.locator("input[name=website]")).not.toBeInViewport();
    await expect(page.getByLabel("Website", { exact: true })).toHaveAttribute("name", "company_website");
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/leaderboard/nominate/");
    // The Turnstile iframe is third-party and not loaded offline.
    const results = await new AxeBuilder({ page }).exclude(".cf-turnstile").analyze();
    expect(results.violations).toEqual([]);
  });
});
