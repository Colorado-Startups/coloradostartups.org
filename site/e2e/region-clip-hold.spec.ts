// The region painting's clip and its hotspot cards, in a real browser
// (RegionArt.astro). With motion allowed the clip plays; an open card holds
// it, so the still shows under the card; it plays again when the last card
// closes, unless the visitor pressed Pause. While a card holds the clip the
// Pause button keeps its label but is aria-disabled and described by a note,
// and a keyboard press on it changes nothing; a mouse click on it closes the
// card and counts as the visitor's Pause. Without the Popover API the clip
// still plays and nothing throws. Every wait is on state, never a
// fixed sleep. The clip files are committed under public/art/brand, so the
// built site serves them (region-clip.test.ts checks they land in dist).
import { expect, type Page, test } from "@playwright/test";

const ROUTE = "/regions/photon-mountain/";

const paused = (page: Page) => page.locator("video[data-region-clip]").evaluate((v: HTMLVideoElement) => v.paused);
// Counts each time the clip starts, so a test can prove it never started.
const plays = (page: Page) => page.evaluate(() => (window as unknown as { clipPlays: number }).clipPlays);
const resetPlays = (page: Page) => page.evaluate(() => ((window as unknown as { clipPlays: number }).clipPlays = 0));

test("an open hotspot card holds the clip, and the Pause button tells the truth", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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

  // A mouse click on Pause itself while a card is open: the click closes the
  // card (light dismiss) and counts as the visitor's own Pause, so the clip
  // stays paused and never starts in between. The card used is one that does
  // not cover the button, so the click lands on the button.
  const toggleBox = (await toggle.boundingBox())!;
  const overlaps = (a: typeof toggleBox, b: typeof toggleBox) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  let clear: Awaited<ReturnType<typeof cardFor>> | undefined;
  for (let i = 0; i < (await hotspots.count()) && !clear; i++) {
    const card = await cardFor(i);
    await hotspots.nth(i).click();
    await expect.poll(() => isOpen(card)).toBe(true);
    if (!overlaps((await card.boundingBox())!, toggleBox)) clear = card;
    else {
      await page.keyboard.press("Escape");
      await expect.poll(() => isOpen(card)).toBe(false);
    }
  }
  expect(clear, "a card that leaves the Pause button uncovered").toBeDefined();
  await expect.poll(() => paused(page)).toBe(true);
  await resetPlays(page);
  // Playwright waits for an aria-disabled button to enable, so force the
  // click: still a real mouse press at the button's center, which the card
  // leaves uncovered (checked above).
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  const hit = await toggle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(hit, "the press lands on the Pause button").toBe(true);
  await toggle.click({ force: true });
  await expect.poll(() => isOpen(clear!)).toBe(false);
  await expect(media).not.toHaveAttribute("data-card-open", /.*/);
  await expect(toggle).toHaveText("Play");
  await expect(toggle).not.toHaveAttribute("aria-disabled", /.*/);
  expect(await paused(page)).toBe(true);
  expect(await plays(page)).toBe(0);

  expect(errors).toEqual([]);
});

test("without the Popover API the clip still plays, the list opens, and nothing throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Before any page script: take Popover away the way an older browser lacks
  // it. The property goes, CSS.supports says no, and the selector throws.
  await page.addInitScript(() => {
    delete (HTMLElement.prototype as { popover?: unknown }).popover;
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((property: string, value?: string) => {
      if (value === undefined) return property.includes(":popover-open") ? false : supports(property);
      return supports(property, value);
    }) as typeof CSS.supports;
    const matches = Element.prototype.matches;
    Element.prototype.matches = function (this: Element, selector: string) {
      if (selector.includes(":popover-open")) throw new DOMException(`'${selector}' is not a valid selector`, "SyntaxError");
      return matches.call(this, selector);
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  const media = page.locator(".region-art__media").first();
  await media.scrollIntoViewIfNeeded();
  await expect(media).toHaveAttribute("data-playing", "true", { timeout: 20_000 });
  await expect.poll(() => paused(page)).toBe(false);
  await expect(page.locator("details[data-painting-links]")).toHaveAttribute("open", "");
  await expect(media.locator("button[data-clip-toggle]")).not.toHaveAttribute("aria-disabled", /.*/);
  expect(errors).toEqual([]);
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
