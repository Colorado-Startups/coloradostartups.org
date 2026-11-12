// Full-page screenshots for the visual-check workflow. VISUAL_PATHS lists site
// routes and VISUAL_WIDTHS viewport widths, both comma-separated. Each pair
// becomes one PNG in test-results/visual-shots/, named <route>-<width>.png,
// and one line in the job summary. The inputs are checked here, not in the
// workflow: a bad route or width fails before any page loads.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const OUT = path.join(process.cwd(), "test-results", "visual-shots");
const MAX_SHOTS = 60;

function routes(raw: string): string[] {
  const list = [...new Set(raw.split(",").map((r) => r.trim()).filter(Boolean))];
  for (const r of list) {
    const ok = r.length <= 200 && /^\/[A-Za-z0-9._~/-]*$/.test(r) && !r.includes("..") && !r.includes("//");
    if (!ok) throw new Error(`VISUAL_PATHS: "${r}" is not a site route like /team/`);
  }
  if (list.length === 0) throw new Error("VISUAL_PATHS names no route");
  return list;
}

function widths(raw: string): number[] {
  const list = [...new Set(raw.split(",").map((w) => w.trim()).filter(Boolean))];
  if (list.length === 0) throw new Error("VISUAL_WIDTHS names no width");
  return list.map((w) => {
    const n = Number(w);
    if (!Number.isInteger(n) || n < 200 || n > 2560) throw new Error(`VISUAL_WIDTHS: "${w}" is not a whole number of px from 200 to 2560`);
    return n;
  });
}

const ROUTES = routes(process.env.VISUAL_PATHS ?? "/");
const WIDTHS = widths(process.env.VISUAL_WIDTHS ?? "375,768,1280");
if (ROUTES.length * WIDTHS.length > MAX_SHOTS) {
  throw new Error(`${ROUTES.length} routes at ${WIDTHS.length} widths is ${ROUTES.length * WIDTHS.length} screenshots; the limit is ${MAX_SHOTS}`);
}

const fileName = (route: string, width: number) =>
  `${route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9]+/g, "-")}-${width}.png`;

mkdirSync(OUT, { recursive: true });

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route} at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status() ?? 0, `${route} should answer with a page`).toBeLessThan(400);
      // Scroll once to the bottom, so lazy images below the fold load.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((done) => setTimeout(done, 50));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const file = fileName(route, width);
      await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: "disabled" });
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- \`${route}\` at ${width} px: \`${file}\`\n`);
    });
  }
}
