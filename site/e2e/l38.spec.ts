// L38: the four volunteer seat pages in a real browser, against the built
// site. Full axe (color contrast included, which jsdom cannot check) at
// desktop width and at 375 px, no sideways scroll on a phone, every figure
// label at 15 px or more and clear of the others, from a phone (#329) to a
// desktop (#367), and the hero button lands on the steps.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SEATS = ["slack-community-lead", "photon-mountain-connector", "space-peak-connector", "fusion-canyon-connector"];

for (const width of [1280, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const id of SEATS) {
      test(`/get-involved/${id}/ passes axe and fits the screen`, async ({ page }) => {
        await page.goto(`/get-involved/${id}/`);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("figure labels", () => {
  // Every visible label draws at 15 px or more (its computed size x the
  // drawing's content width / its viewBox width), sits inside its drawing,
  // and overlaps no other label. Hidden drawings measure 0 px wide and are
  // skipped. Up to 729 px each map and diagram shows its phone drawing
  // (#329). 729 and 731 px sit either side of the 730 px swap: at 729 the
  // wide drawing showed 679 px wide, at 14.98 px labels (#374). 900, 1024 and
  // 1280 px are the issue's two-column widths, where the 680-unit drawings
  // drew 9 to 12.7 px labels (#367); 1089 px is the first width with the
  // figure beside the text, and 1600 px the widest the fix covers.
  for (const width of [360, 375, 729, 731, 900, 1024, 1089, 1280, 1600]) {
    for (const id of SEATS) {
      test(`/get-involved/${id}/ draws its map and diagram labels at 15 px or more at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await page.goto(`/get-involved/${id}/`);
        const problems = await page.evaluate(() =>
          [...document.querySelectorAll<SVGSVGElement>("main figure svg[role='img']")]
            .filter((svg) => svg.getBoundingClientRect().width > 0)
            .flatMap((svg) => {
              const box = svg.getBoundingClientRect();
              // The content width, inside the figure's 1 px border.
              const cs = getComputedStyle(svg);
              const content = box.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
              const scale = content / svg.viewBox.baseVal.width;
              const labels = [...svg.querySelectorAll("text")]
                .filter((t) => (t.textContent ?? "").trim())
                .map((t) => ({ text: t.textContent, px: parseFloat(getComputedStyle(t).fontSize) * scale, r: t.getBoundingClientRect() }));
              const out: string[] = [];
              for (const l of labels) {
                if (l.px < 14.99) out.push(`${l.text}: ${l.px.toFixed(1)} px`);
                if (l.r.left < box.left - 0.5 || l.r.right > box.right + 0.5 || l.r.top < box.top - 0.5 || l.r.bottom > box.bottom + 0.5) out.push(`${l.text}: outside`);
              }
              for (const [i, a] of labels.entries()) {
                for (const b of labels.slice(i + 1)) {
                  if (a.r.left < b.r.right - 0.5 && b.r.left < a.r.right - 0.5 && a.r.top < b.r.bottom - 0.5 && b.r.top < a.r.bottom - 0.5) out.push(`${a.text} / ${b.text}`);
                }
              }
              return out;
            }),
        );
        expect(problems).toEqual([]);
      });
    }
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the hero button lands on the steps, before the apply button", async ({ page }) => {
    await page.goto("/get-involved/space-peak-connector/");
    await page.locator("[data-hero-cta]").click();
    await expect(page).toHaveURL(/#how-to-apply$/);
    await expect(page.locator("#how-to-apply [data-steps]")).toBeInViewport();
  });
});
