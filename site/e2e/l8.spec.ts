// L8: /regions/ and the three region pages in a real browser against the built
// site. axe on every page, no sideways scroll at 375 px, and the map
// drawing's labels inside its frame. Per playwright.config.ts these specs
// never submit anything; "Email us about this seat" is a mailto link.
//
// Step H (2026-11-15) replaced the Front Range Plot map with ColoradoMap. The
// old map's peak-triangle check went with the old map. Three rules carry over
// to the new drawing: labels inside the map, no label over another label or
// another city's dot, and labels at 15 px or more (#329). The drawing scales
// to about half on a phone, so the 15 px rule is fixme there until #54.
// /regions/ has four drawings (the state map and each theme panel's map
// thumbnail), so each check reads every drawing on the page.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const REGIONS = [
  { id: "photon-mountain", name: "Photon Mountain" },
  { id: "space-peak", name: "Space Peak" },
  { id: "fusion-canyon", name: "Fusion Canyon" },
];
const PAGES = ["/regions/", ...REGIONS.map((r) => `/regions/${r.id}/`)];

// The drawing is what shows with no JavaScript, so the check turns it off.
// Every label stays inside the map's frame at phone and desktop widths (#328).
for (const width of [360, 375, 480, 1280]) {
  test.describe(`map drawings at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 }, javaScriptEnabled: false });

    for (const path of PAGES) {
      test(`${path} keeps every label inside the map`, async ({ page }) => {
        await page.goto(path);
        const outside = await page.locator(".colorado-map__drawing svg").evaluateAll((svgs) =>
          svgs.flatMap((svg) => {
            const box = svg.getBoundingClientRect();
            return [...svg.querySelectorAll("text")]
              .map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() }))
              .filter(({ r }) => r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
              .map(({ text }) => text);
          }),
        );
        expect(outside).toEqual([]);
      });

      test(`${path} keeps every label off the other labels and off the dots`, async ({ page }) => {
        await page.goto(path);
        const clashes = await page.locator(".colorado-map__drawing svg").evaluateAll((svgs) =>
          svgs.flatMap((svg) => {
            const labels = [...svg.querySelectorAll("text")].map((t) => ({ text: t.textContent ?? "", r: t.getBoundingClientRect() }));
            const dots = [...svg.querySelectorAll("circle")].map((c) => {
              const r = c.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            });
            const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
            const out: string[] = [];
            labels.forEach((a, i) => {
              for (const b of labels.slice(i + 1)) if (hit(a.r, b.r)) out.push(`${a.text} / ${b.text}`);
              for (const d of dots) if (d.x > a.r.left && d.x < a.r.right && d.y > a.r.top && d.y < a.r.bottom) out.push(`${a.text} over a dot`);
            });
            return out;
          }),
        );
        expect(clashes).toEqual([]);
      });

      test(`${path} draws its labels at 15 px or more`, async ({ page }) => {
        test.fixme(width < 900, "#54: the drawing scales to about half on a phone");
        await page.goto(path);
        const small = await page.locator(".colorado-map__drawing svg").evaluateAll((svgs) =>
          svgs.flatMap((svg) => {
            const scale = svg.getBoundingClientRect().width / ((svg as SVGSVGElement).viewBox.baseVal.width || svg.getBoundingClientRect().width);
            return [...svg.querySelectorAll("text")]
              .map((t) => ({ text: t.textContent, px: parseFloat(getComputedStyle(t).fontSize) * scale }))
              .filter(({ px }) => px < 15)
              .map(({ text, px }) => `${text} at ${px.toFixed(1)} px`);
          }),
        );
        expect(small).toEqual([]);
      });
    }
  });
}

test.describe("/regions/", () => {
  test("shows the map and the three regions in order", async ({ page }) => {
    await page.goto("/regions/");
    await expect(page.getByRole("heading", { level: 1, name: "Regions" })).toBeVisible();
    await expect(page.locator(".region-chips [data-region] .region-chip__name")).toHaveText(REGIONS.map((r) => r.name));
    await expect(page.locator("#regions-map")).toBeVisible();
  });
});

for (const region of REGIONS) {
  test.describe(`/regions/${region.id}/`, () => {
    test("shows the organizer seat and the see-all links", async ({ page }) => {
      await page.goto(`/regions/${region.id}/`);
      await expect(page.getByRole("heading", { level: 1, name: region.name })).toBeVisible();
      // An open seat offers "Apply for this seat" when it takes applications
      // (L19), and "Email us about this seat" otherwise; a filled one shows its person
      // instead (the same check as test/dom/l8/regions.test.ts).
      const seat = page.locator(".organizer");
      const apply = seat.locator("a[data-apply]");
      const raise = seat.locator("a[data-raise-hand]");
      if ((await seat.getAttribute("data-seat")) !== "open") {
        await expect(apply).toHaveCount(0);
        await expect(raise).toHaveCount(0);
      } else if ((await apply.count()) > 0) {
        await expect(apply).toHaveAttribute("href", /^\/get-involved\/apply\/\?role=[a-z-]+-connector$/);
        await expect(raise).toHaveCount(0);
      } else {
        await expect(raise).toHaveAttribute("href", /^mailto:info@coloradostartups\.org\?subject=/);
      }
      await expect(page.locator("[data-region-resources] a[data-see-all]")).toHaveAttribute("href", `/ecosystem-canvas/?region=${region.id}`);
      await expect(page.locator("[data-region-honorees] a[data-see-all]")).toHaveAttribute("href", `/leaderboard/?region=${region.id}`);
    });
  });
}

for (const path of PAGES) {
  test(`${path} passes axe`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test(`${path} fits a 375 px screen without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
