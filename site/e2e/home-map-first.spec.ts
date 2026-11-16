import { expect, test, type Page } from "@playwright/test";

// Home leads with Colorado (Paul, 2026-11-16: "they're supposed to be seeing
// the map, they're supposed to be seeing where they can engage"). In the first
// screen: the name and the two join buttons, then the statewide map, its relief
// the largest paint, with the three regions' counts beside it on a laptop and
// under it on a phone. Golden's painting sits at the end, in the Keepers band,
// and fetches nothing until a visitor nears it.
// test/dom/home/map-first.test.ts checks the built HTML.

const MAP = "#home-map .colorado-map__box";
const ROWS = "table[data-zone-counts] tbody tr";
const PAINTING = '[data-art="brand/golden"]';

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const joinBox = async (page: Page, name: string) => (await page.locator("main").getByRole("link", { name, exact: true }).first().boundingBox())!;

// Keeps each largest-contentful-paint candidate's element, before any of the
// page's scripts run. The last candidate is the LCP.
function observeLcp() {
  const seen: string[] = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const el = (e as PerformanceEntry & { element?: Element | null }).element;
      seen.push(el ? `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}` : "");
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  Object.defineProperty(window, "__lcpElements", { value: seen });
}

async function lcpElement(page: Page): Promise<string> {
  await page.addInitScript(observeLcp);
  await page.goto("/", { waitUntil: "load" });
  await page.waitForTimeout(1000);
  return page.evaluate(() => (window as unknown as { __lcpElements: string[] }).__lcpElements.at(-1) ?? "");
}

test.describe("home at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the map and every region's counts are in the first screen, under the join buttons", async ({ page }) => {
    await page.goto("/");
    const map = await box(page, MAP);
    const slack = await joinBox(page, "Join the Slack");
    const linkedin = await joinBox(page, "Join the LinkedIn Group");
    expect(slack.y + slack.height, "Join the Slack in the first screen").toBeLessThanOrEqual(800);
    expect(map.y, "the map follows the join buttons").toBeGreaterThanOrEqual(Math.max(slack.y + slack.height, linkedin.y + linkedin.height));
    expect(map.y + map.height, "the whole map in the first screen").toBeLessThanOrEqual(800);
    const rows = page.locator(ROWS);
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      const r = (await row.boundingBox())!;
      expect(r.x, "the regions beside the map").toBeGreaterThanOrEqual(map.x + map.width);
      expect(r.y + r.height, "each region's row in the first screen").toBeLessThanOrEqual(800);
    }
    expect((await box(page, PAINTING)).y, "the painting far below").toBeGreaterThan(2 * 800);
  });

  test("the map's relief is the largest paint", async ({ page }) => {
    expect(await lcpElement(page)).toMatch(/^img\.(?:[\w-]+\.)*colorado-map__relief(?:\.|$)/);
  });
});

test.describe("home at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the map comes right under the join buttons, before the regions' counts", async ({ page }) => {
    await page.goto("/");
    const map = await box(page, MAP);
    const linkedin = await joinBox(page, "Join the LinkedIn Group");
    const title = await box(page, "#where");
    expect(map.y, "the map follows the join buttons").toBeGreaterThanOrEqual(linkedin.y + linkedin.height);
    expect(title.y, "only the map's heading between them").toBeGreaterThanOrEqual(linkedin.y + linkedin.height);
    expect(map.y, "the map starts in the first screen").toBeLessThan(812);
    expect(map.y + map.height / 2, "most of the map in the first screen").toBeLessThan(812);
    const first = await box(page, ROWS);
    expect(first.y, "the counts follow the map").toBeGreaterThanOrEqual(map.y + map.height - 1);
    expect((await box(page, PAINTING)).y, "the painting far below").toBeGreaterThan(first.y);
  });

  test("the map's relief is the largest paint", async ({ page }) => {
    expect(await lcpElement(page)).toMatch(/^img\.(?:[\w-]+\.)*colorado-map__relief(?:\.|$)/);
  });
});

test("Golden's painting fetches nothing with the first screen, and loads once it nears the screen", async ({ page }) => {
  const art: string[] = [];
  page.on("request", (r) => {
    if (/\/art\/brand\/golden/.test(r.url())) art.push(r.url());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "load" });
  expect(art, "nothing of the painting loads with the first screen").toEqual([]);
  await page.locator(`${PAINTING} img`).scrollIntoViewIfNeeded();
  await expect.poll(() => art.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator(`${PAINTING} img`)).toHaveJSProperty("complete", true);
});
