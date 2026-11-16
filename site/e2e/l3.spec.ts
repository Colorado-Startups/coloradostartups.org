// L3: Startup Resources (the Ecosystem Canvas directory) and the
// suggest-a-resource page, in a real browser against the built site. Per
// playwright.config.ts these specs never submit a form; the POST contract is
// in test/worker/l3/.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const visibleCards = (page: Page) => page.locator("[data-resource]:not([hidden])");

// Step F (2026-11-15): stage and type are radio chips, the stage chips drawn
// as the journey with their counts; the list shows 24 matches at a time.
const chip = (page: Page, name: "stage" | "type", value: string) => page.locator(`input[name="${name}"][value="${value}"]`);
// The list's own count line. The "Ask your AI" row has a status line too.
const count = (page: Page) => page.locator("[data-canvas-count]");
// Step L1b: the page opens on its picks; the full list waits behind this.
const openList = async (page: Page) => {
  await page.goto("/ecosystem-canvas/");
  await page.getByRole("button", { name: /^Show all \d+ resources$/ }).click();
};

test.describe("/ecosystem-canvas/", () => {
  test("opens on its picks, with the full list closed behind its control", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const picks = page.locator("[data-pick]");
    expect(await picks.count()).toBeGreaterThan(0);
    await expect(page.locator("[data-resource]").first()).toBeHidden();
    const show = page.getByRole("button", { name: /^Show all \d+ resources$/ });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await show.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Find a resource" })).toBeFocused();
    await expect(visibleCards(page)).toHaveCount(24);
  });

  test("keeps the search box above the picks; typing opens and filters the list", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const search = page.getByRole("searchbox", { name: "Search" });
    await expect(search).toBeVisible();
    await search.fill("coworking");
    await expect(count(page)).toHaveText(/^\d+ of \d+ resources match\.$/);
    await expect(page.locator("[data-canvas-picks]")).toBeHidden();
    expect(await visibleCards(page).count()).toBeGreaterThan(0);
  });

  test("a browse row link opens the list filtered to its stage and substage", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const link = page.locator("[data-browse-row] a[data-substage]").first();
    const substage = await link.getAttribute("data-substage");
    const n = Number(await link.getAttribute("data-count"));
    // The link says "27 investors"; the chip says "Investors".
    const label = (await link.textContent())!.trim().replace(/^\d+\s+/, "");
    await link.click();
    await expect(page.locator("[data-canvas-full]")).toBeVisible();
    await expect(count(page)).toHaveText(new RegExp(`^${n} of \\d+ resources match\\.$`));
    for (const el of await visibleCards(page).all()) await expect(el).toHaveAttribute("data-substage", substage!);

    // The kind shows as a chip with its display name, and removing it keeps
    // the stage: the count returns to the stage's count in the rail, plus
    // Support, which shows alongside every stage (#134).
    const stage = new URL(page.url()).searchParams.get("stage")!;
    const chip = page.locator("[data-canvas-kind]");
    await expect(chip).toBeVisible();
    await expect(page.locator("[data-canvas-kind-name]")).toHaveText(new RegExp(`^${label}s?$`, "i"));
    const remove = page.getByRole("button", { name: "Remove the kind filter" });
    const box = await remove.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(chip).toBeHidden();
    await expect(count(page)).toBeFocused();
    const rail = async (s: string) => Number(await page.locator(`[data-stage-count="${s}"]`).textContent());
    const stageN = (await rail(stage)) + (stage === "support" ? 0 : await rail("support"));
    expect(stageN).toBeGreaterThan(n);
    await expect(count(page)).toHaveText(new RegExp(`^${stageN} of \\d+ resources match\\.$`));
    expect(new URL(page.url()).searchParams.get("substage")).toBeNull();
    expect(new URL(page.url()).searchParams.get("stage")).toBe(stage);
  });

  test("opens the full list on a link to a resource that is not a pick", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const id = await page.evaluate(() => {
      const picked = new Set([...document.querySelectorAll<HTMLElement>("[data-pick]")].map((p) => p.dataset.id));
      const rows = [...document.querySelectorAll<HTMLElement>("[data-resource]")].filter((r) => !picked.has(r.dataset.id));
      // The last row sits far past the first page of 24.
      return rows.at(-1)?.dataset.id ?? "";
    });
    expect(id).not.toBe("");
    const fresh = await page.context().newPage();
    await fresh.goto(`/ecosystem-canvas/#r-${id}`);
    await expect(fresh.locator("[data-canvas-full]")).toBeVisible();
    await expect(fresh.locator(`[data-resource][data-id="${id}"]`)).toBeVisible();
    await expect(fresh.locator(`#r-${id}`)).toBeInViewport();
    await fresh.close();
  });

  test("shows the full list below the picks without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/ecosystem-canvas/");
    await expect(page.locator("[data-resource]").first()).toBeVisible();
    await expect(page.locator("[data-canvas-show-all]")).toBeHidden();
    await context.close();
  });

  test("shows every stage, with the anchors other lanes link to", async ({ page }) => {
    await openList(page);
    await expect(page.getByRole("heading", { level: 1, name: "Startup Resources" })).toBeVisible();
    for (const stage of ["idea", "launch", "growth", "support"]) {
      await expect(page.locator(`section#${stage}`)).toHaveCount(1);
    }
    const closing = page.getByRole("region", { name: "Missing something?" });
    await expect(closing.getByRole("link", { name: "Founder Institute" })).toHaveAttribute("href", "https://fi.co/");
    await expect(count(page)).toHaveText(/^All \d+ resources\.$/);
    await expect(visibleCards(page)).toHaveCount(24);
    // Hidden means not drawn: a row past the first page takes no room.
    await expect(page.locator("[data-resource]").nth(24)).toBeHidden();
  });

  test("filters by stage and type in place, and keeps the filters in the URL", async ({ page }) => {
    await openList(page);
    const total = Number((await count(page).textContent())?.match(/\d+/)?.[0]);
    await chip(page, "stage", "launch").check();
    await chip(page, "type", "investor").check();
    await expect(page).toHaveURL(/\?stage=launch&type=investor$/);
    await expect(count(page)).toHaveText(/^\d+ of \d+ resources match\.$/);
    const shown = visibleCards(page);
    expect(await shown.count()).toBeGreaterThan(0);
    expect(await shown.count()).toBeLessThanOrEqual(24);
    // Support sits alongside every level, so it shows under Launch too (#134).
    for (const el of await shown.all()) {
      await expect(el).toHaveAttribute("data-stage", /^(launch|support)$/);
      await expect(el).toHaveAttribute("data-type", "investor");
    }
    await expect(page.locator("section#growth")).toBeHidden();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(count(page)).toHaveText(`All ${total} resources.`);
  });

  test("shows 24 more on Show more", async ({ page }) => {
    await openList(page);
    await page.getByRole("button", { name: "Show 24 more" }).click();
    await expect(visibleCards(page)).toHaveCount(48);
    await expect(page.locator("[data-resource]").nth(47)).toBeVisible();
    await expect(page.locator("[data-resource]").nth(48)).toBeHidden();
  });

  test("opens with the filters a link carries, and a stage anchor chooses its stage", async ({ page }) => {
    await page.goto("/ecosystem-canvas/?stage=growth&city=Denver");
    await expect(chip(page, "stage", "growth")).toBeChecked();
    for (const el of await visibleCards(page).all()) await expect(el).toHaveAttribute("data-city", "Denver");
    await page.goto("/ecosystem-canvas/#launch");
    await expect(chip(page, "stage", "launch")).toBeChecked();
    await expect(page).toHaveURL(/\?stage=launch#launch$/);
  });

  test("searches with Pagefind and treats several words as all of them", async ({ page }) => {
    await openList(page);
    // By role: "Search Startup Resources" also labels the search landmark.
    await page.getByRole("searchbox", { name: "Search", exact: true }).fill("coworking boulder");
    await expect(count(page)).toHaveText(/^\d+ of \d+ resources match\.$/);
    const shown = visibleCards(page);
    expect(await shown.count()).toBeGreaterThan(0);
    for (const el of await shown.all()) await expect(el).toContainText(/coworking/i);
  });

  test("passes axe, with the list closed and open", async ({ page }) => {
    await page.goto("/ecosystem-canvas/");
    const closed = await new AxeBuilder({ page }).analyze();
    expect(closed.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await page.getByRole("button", { name: /^Show all \d+ resources$/ }).click();
    const open = await new AxeBuilder({ page }).analyze();
    expect(open.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
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
