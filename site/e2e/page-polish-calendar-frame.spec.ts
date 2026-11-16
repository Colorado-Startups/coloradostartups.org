import { expect, type Page, test } from "@playwright/test";

// Page polish lane, #227: the note behind the Google Calendar frame. A loaded
// frame covers it; a frame that a blocker hides leaves it showing. Since L2a
// the frame sits behind the "Full calendar" disclosure, so each test opens it.

const openCalendar = (page: Page) => page.locator("details[data-full-calendar] > summary").click();

const frameCenterHit = () => {
  const frame = document.querySelector(".calendar .frame")!;
  frame.scrollIntoView({ block: "center" });
  const box = frame.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { tag: hit?.tagName ?? "", inFallback: !!hit?.closest(".fallback") };
};

test.describe("event calendar frame", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the iframe paints over the fallback note", async ({ page }) => {
    await page.goto("/event-calendar/");
    await openCalendar(page);
    expect(await page.evaluate(frameCenterHit)).toEqual({ tag: "IFRAME", inFallback: false });
  });

  test("a hidden iframe leaves the fallback note and its link showing", async ({ page }) => {
    await page.goto("/event-calendar/");
    await openCalendar(page);
    await page.addStyleTag({ content: ".calendar iframe { display: none !important; }" });
    expect((await page.evaluate(frameCenterHit)).inFallback).toBe(true);
    await expect(page.locator(".calendar .fallback a")).toBeVisible();
  });
});
