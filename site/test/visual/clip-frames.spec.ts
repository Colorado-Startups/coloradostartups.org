// Region clips, playing, for the visual-check workflow (step W3b). Runs only
// when VISUAL_CLIP_TIMES lists seconds into the clip, such as 0.2,2,3.8. For
// each route in VISUAL_PATHS that has a region clip and each width in
// VISUAL_WIDTHS, it lets the clip play as a visitor without reduced motion
// sees it, then holds it at each time and screenshots the painting's box with
// its hotspots: <route>-<width>-clip-<seconds>.png. It also shoots the same
// box with the clip hidden, <route>-<width>-still.png, so the marks can be
// checked against both layers.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const OUT = path.join(process.cwd(), "test-results", "visual-shots");
const RAW = process.env.VISUAL_CLIP_TIMES ?? "";

function times(raw: string): number[] {
  const list = [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];
  if (list.length > 6) throw new Error("VISUAL_CLIP_TIMES lists more than 6 times");
  return list.map((t) => {
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error(`VISUAL_CLIP_TIMES: "${t}" is not a number of seconds from 0 to 10`);
    return n;
  });
}

const TIMES = times(RAW);
const ROUTES = (process.env.VISUAL_PATHS ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter((r) => /^\/regions\/[a-z-]+\/$/.test(r));
const WIDTHS = (process.env.VISUAL_WIDTHS ?? "375,1280")
  .split(",")
  .map((w) => Number(w.trim()))
  .filter((w) => Number.isInteger(w) && w >= 200 && w <= 2560);
const stem = (route: string, width: number) => `${route.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9]+/g, "-")}-${width}`;

test.skip(TIMES.length === 0 || ROUTES.length === 0, "VISUAL_CLIP_TIMES is empty or VISUAL_PATHS names no region page");
mkdirSync(OUT, { recursive: true });

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route} clip at ${width} px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status() ?? 0).toBeLessThan(400);
      const media = page.locator(".region-art__media").first();
      await media.scrollIntoViewIfNeeded();
      // The page's own script starts the clip once the painting is on screen.
      await expect(media).toHaveAttribute("data-playing", "true", { timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const summary: string[] = [];
      for (const t of TIMES) {
        await page.evaluate(async (at) => {
          const video = document.querySelector<HTMLVideoElement>("[data-region-clip]")!;
          video.pause();
          const end = Math.max(0, video.duration - 0.05);
          await new Promise<void>((done) => {
            video.addEventListener("seeked", () => done(), { once: true });
            video.currentTime = Math.min(at, end);
          });
        }, t);
        const file = `${stem(route, width)}-clip-${t}.png`;
        await media.screenshot({ path: path.join(OUT, file) });
        summary.push(file);
      }
      await page.evaluate(() => {
        document.querySelector<HTMLVideoElement>("[data-region-clip]")!.style.visibility = "hidden";
      });
      const still = `${stem(route, width)}-still.png`;
      await media.screenshot({ path: path.join(OUT, still) });
      summary.push(still);
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- \`${route}\` clip at ${width} px: ${summary.map((f) => `\`${f}\``).join(", ")}\n`);
      }
    });
  }
}
