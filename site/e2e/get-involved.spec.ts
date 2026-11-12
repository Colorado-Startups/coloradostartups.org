// /get-involved/ in a real browser against the built site: the first screen
// and the seat cards' layout, which jsdom cannot measure. The markup checks
// (which button is gold, where it links) live in test/dom/l9/team.test.ts.
import { expect, type Page, test } from "@playwright/test";

/** Each seat card's empty space between its text and its button row, in px, past the card body's own gap. */
async function holesAboveButtons(page: Page): Promise<Record<string, number>> {
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.locator("[data-position]").evaluateAll((cards) =>
    cards.map((card) => {
      const body = card.querySelector(".hall-card__body")!;
      const text = card.querySelector(".hall-card__text")!.getBoundingClientRect();
      const foot = card.querySelector(".hall-card__foot")!.getBoundingClientRect();
      const gap = Number.parseFloat(getComputedStyle(body).rowGap) || 0;
      return [(card as HTMLElement).dataset.position ?? "?", Math.round(foot.top - text.bottom - gap)] as const;
    }),
  );
  return Object.fromEntries(rows);
}

for (const width of [1280, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("shows a gold See open seats button in the first screen, and it lands on the seats (#229)", async ({
      page,
    }) => {
      await page.goto("/get-involved/");
      const cta = page.getByRole("link", { name: "See open seats" });
      await expect(cta).toBeInViewport({ ratio: 1 });
      await expect(cta).toHaveClass(/\bbtn--gold\b/);
      await cta.click();
      await expect(page).toHaveURL(/#community$/);
      await expect(page.locator("#community h2")).toBeInViewport();
    });

    test("puts each seat's button row right under its text (#230)", async ({ page }) => {
      await page.goto("/get-involved/");
      const holes = await holesAboveButtons(page);
      expect(Object.keys(holes).length).toBeGreaterThan(0);
      // One pixel of slack for subpixel rounding.
      expect(Object.entries(holes).filter(([, px]) => px > 1)).toEqual([]);
    });
  });
}

test.describe("at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  // #230 kept every card in a row one height; the 2026-11-04 design re-score
  // (#723) asked that a short card end at its content instead. A row still
  // shares one top edge, and no card keeps spare height under its buttons.
  test("starts each row of seat cards on one top edge and ends each card at its content (#723)", async ({ page }) => {
    await page.goto("/get-involved/");
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.locator("[data-position]").evaluateAll((cards) =>
      cards.map((card) => {
        const r = card.getBoundingClientRect();
        const foot = card.querySelector(".hall-card__foot")!.getBoundingClientRect();
        const body = getComputedStyle(card.querySelector(".hall-card__body")!);
        const edge = Number.parseFloat(getComputedStyle(card).borderBottomWidth) || 0;
        const spare = r.bottom - foot.bottom - (Number.parseFloat(body.paddingBottom) || 0) - edge;
        return { id: (card as HTMLElement).dataset.position ?? "?", top: Math.round(r.top), spare: Math.round(spare) };
      }),
    );
    const tops = new Set(boxes.map((b) => b.top));
    // Some row must hold two cards or more, or the check proves nothing.
    expect(tops.size).toBeLessThan(boxes.length);
    // One pixel of slack for subpixel rounding.
    expect(boxes.filter((b) => b.spare > 1)).toEqual([]);
  });
});
