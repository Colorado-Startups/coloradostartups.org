// The region painting's clip and its hotspot cards, in a real browser
// (RegionArt.astro). With motion allowed the clip plays; an open card holds
// it, so the still shows under the card; it plays again when the last card
// closes, unless the visitor pressed Pause. While a card holds the clip the
// Pause button keeps its label but is aria-disabled and described by a note,
// and a keyboard press on it changes nothing. Every wait is on state, never a
// fixed sleep. The clip files are committed under public/art/brand, so the
// built site serves them (region-clip.test.ts checks they land in dist).
import { expect, type Page, test } from "@playwright/test";

const ROUTE = "/regions/photon-mountain/";

const paused = (page: Page) => page.locator("video[data-region-clip]").evaluate((v: HTMLVideoElement) => v.paused);
// Counts each time the clip starts, so a test can prove it never started.
const plays = (page: Page) => page.evaluate(() => (window as unknown as { clipPlays: number }).clipPlays);
const resetPlays = (page: Page) => page.evaluate(() => ((window as unknown as { clipPlays: number }).clipPlays = 0));

test("an open hotspot card holds the clip, and the Pause button tells the truth", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  const media = page.locator(".region-art__media").first();
  const toggle = media.locator("button[data-clip-toggle]");
  const hotspots = media.locator(".hotspots button[popovertarget]");
  const cardFor = async (i: number) => page.locator(`[id="${await hotspots.nth(i).getAttribute("popovertarget")}"]`);
  const isOpen = (card: Awaited<ReturnType<typeof cardFor>>) => card.evaluate((el) => el.matches(":popover-open"));

  await media.scrollIntoViewIfNeeded();
  // The page's own script starts the clip once the painting is on screen.
  await expect(media).toHaveAttribute("data-playing", "true", { timeout: 20_000 });
  await expect.poll(() => paused(page)).toBe(false);
  await page.evaluate(() => {
    const w = window as unknown as { clipPlays: number };
    w.clipPlays = 0;
    document.querySelector("video[data-region-clip]")!.addEventListener("play", () => w.clipPlays++);
  });
  await expect(toggle).toHaveText("Pause");
  await expect(toggle).not.toHaveAttribute("aria-disabled", /.*/);

  // Opening a card pauses the clip and shows the still.
  const first = await cardFor(0);
  await hotspots.nth(0).click();
  await expect.poll(() => isOpen(first)).toBe(true);
  await expect(media).toHaveAttribute("data-card-open", "");
  await expect.poll(() => paused(page)).toBe(true);
  // The button keeps the visitor's label, rests, and says why.
  await expect(toggle).toHaveText("Pause");
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await expect(toggle).toHaveAccessibleDescription("The clip is paused while a card is open.");

  // A keyboard press on the resting button starts nothing and changes nothing.
  await resetPlays(page);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveText("Pause");
  await expect.poll(() => isOpen(first)).toBe(true);
  expect(await paused(page)).toBe(true);
  expect(await plays(page)).toBe(0);

  // Escape closes the card, and the clip plays again.
  await page.keyboard.press("Escape");
  await expect.poll(() => isOpen(first)).toBe(false);
  await expect(media).not.toHaveAttribute("data-card-open", /.*/);
  await expect(toggle).not.toHaveAttribute("aria-disabled", /.*/);
  await expect(toggle).not.toHaveAttribute("aria-describedby", /.*/);
  await expect.poll(() => paused(page)).toBe(false);

  // A second card replacing the first keeps the clip paused throughout.
  await hotspots.nth(0).click();
  await expect.poll(() => paused(page)).toBe(true);
  await resetPlays(page);
  const second = await cardFor(1);
  await hotspots.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => isOpen(second)).toBe(true);
  await expect.poll(() => isOpen(first)).toBe(false);
  await expect(media).toHaveAttribute("data-card-open", "");
  expect(await paused(page)).toBe(true);
  expect(await plays(page)).toBe(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => isOpen(second)).toBe(false);
  await expect.poll(() => paused(page)).toBe(false);

  // The visitor's own Pause wins: a card opening and closing leaves it paused.
  await toggle.click();
  await expect(toggle).toHaveText("Play");
  await expect.poll(() => paused(page)).toBe(true);
  await resetPlays(page);
  await hotspots.nth(0).click();
  await expect.poll(() => isOpen(first)).toBe(true);
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await expect(toggle).toHaveText("Play");
  await page.keyboard.press("Escape");
  await expect.poll(() => isOpen(first)).toBe(false);
  await expect(media).not.toHaveAttribute("data-card-open", /.*/);
  await expect(toggle).not.toHaveAttribute("aria-disabled", /.*/);
  await expect(toggle).toHaveText("Play");
  expect(await paused(page)).toBe(true);
  expect(await plays(page)).toBe(0);

  // Play again, then a click outside the card (light dismiss) resumes the clip.
  await toggle.click();
  await expect(toggle).toHaveText("Pause");
  await expect.poll(() => paused(page)).toBe(false);
  await hotspots.nth(0).click();
  await expect.poll(() => paused(page)).toBe(true);
  // The page's side gutter: outside the 1180 px wrap, and outside the card.
  const box = (await first.boundingBox())!;
  expect(box.x).toBeGreaterThan(10);
  await page.mouse.click(4, 450);
  await expect.poll(() => isOpen(first)).toBe(false);
  await expect(media).not.toHaveAttribute("data-card-open", /.*/);
  await expect(toggle).toHaveText("Pause");
  await expect.poll(() => paused(page)).toBe(false);
});

test("under reduced motion the still shows and no clip logic runs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(ROUTE);
  const media = page.locator(".region-art__media").first();
  const hotspot = media.locator(".hotspots button[popovertarget]").nth(0);
  const card = page.locator(`[id="${await hotspot.getAttribute("popovertarget")}"]`);
  await hotspot.click();
  await expect.poll(() => card.evaluate((el) => el.matches(":popover-open"))).toBe(true);
  // No script marks the box or the button, and the clip never started.
  await expect(media).not.toHaveAttribute("data-card-open", /.*/);
  await expect(media.locator("button[data-clip-toggle]")).not.toHaveAttribute("aria-disabled", /.*/);
  await expect(media).not.toHaveAttribute("data-playing", /.*/);
  expect(await paused(page)).toBe(true);
});
