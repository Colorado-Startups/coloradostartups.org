// Full-page screenshots for the visual-check workflow. VISUAL_PATHS lists site
// routes, VISUAL_WIDTHS viewport widths and VISUAL_SCHEMES the system color
// schemes (light, dark), all comma-separated. Each triple becomes one PNG in
// test-results/visual-shots/, named <route>-<width>.png for light and
// <route>-<width>-dark.png for dark, and one line in the job summary. The inputs are checked here, not in the
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

const SCHEME_NAMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEME_NAMES)[number];

function schemes(raw: string): Scheme[] {
  const list = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (list.length === 0) throw new Error("VISUAL_SCHEMES names no scheme");
  for (const s of list) if (!(SCHEME_NAMES as readonly string[]).includes(s)) throw new Error(`VISUAL_SCHEMES: "${s}" is not light or dark`);
  return list as Scheme[];
}

const ROUTES = routes(process.env.VISUAL_PATHS ?? "/");
const WIDTHS = widths(process.env.VISUAL_WIDTHS ?? "375,768,1280");
const SCHEMES = schemes(process.env.VISUAL_SCHEMES ?? "light");
const SHOTS = ROUTES.length * WIDTHS.length * SCHEMES.length;
if (SHOTS > MAX_SHOTS) {
  throw new Error(`${ROUTES.length} routes at ${WIDTHS.length} widths in ${SCHEMES.length} schemes is ${SHOTS} screenshots; the limit is ${MAX_SHOTS}`);
}

// A light shot keeps the name it always had; a dark one ends in -dark.
const fileName = (route: string, width: number, scheme: Scheme) =>
  `${route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9]+/g, "-")}-${width}${scheme === "dark" ? "-dark" : ""}.png`;

mkdirSync(OUT, { recursive: true });

for (const scheme of SCHEMES) {
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      test(`${route} at ${width} px, ${scheme}`, async ({ page }) => {
        // The system setting the page reads through prefers-color-scheme.
        await page.emulateMedia({ colorScheme: scheme });
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
        const file = fileName(route, width, scheme);
        await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: "disabled" });
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- \`${route}\` at ${width} px, ${scheme}: \`${file}\`\n`);
      });
    }
  }
}
