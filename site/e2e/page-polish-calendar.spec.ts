import { expect, test } from "@playwright/test";

// Page polish lane: the event calendar page in a real browser, against the
// built site. jsdom cannot lay out a page, so line lengths are checked here.

test.describe("event calendar at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // #226: the caption ran as one line across the whole 1,180 px wrap.
  test("the calendar caption keeps the text measure", async ({ page }) => {
    await page.goto("/event-calendar/");
    const caption = page.locator(".calendar figcaption");
    const { width, maxWidth, wrapWidth } = await caption.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      maxWidth: getComputedStyle(el).maxWidth,
      wrapWidth: el.closest(".wrap")!.getBoundingClientRect().width,
    }));
    expect(maxWidth).not.toBe("none");
    expect(width).toBeLessThanOrEqual(parseFloat(maxWidth));
    expect(width).toBeLessThan(wrapWidth * 0.75);
  });
});
