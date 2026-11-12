// L8: /regions/ and the three region pages in a real browser against the built
// site. axe on every page, no sideways scroll at 375 px, and the resource
// stages open without JavaScript (they are <details>). Per playwright.config.ts
// these specs never submit anything; "Email us about this seat" is a mailto link.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const REGIONS = [
  { id: "photon-mountain", name: "Photon Mountain" },
  { id: "space-peak", name: "Space Peak" },
  { id: "fusion-canyon", name: "Fusion Canyon" },
];
const PAGES = ["/regions/", ...REGIONS.map((r) => `/regions/${r.id}/`)];

// Every map label stays inside the map's own box at phone widths (#328), off
// the peak triangles, off the other labels and off the other cities' dots
// (reviews of #344). The labels' sides and offsets apply at every width, so
// the checks run at 1280 px too.
for (const width of [360, 375, 480, 1280]) {
  test.describe(`/regions/ map at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("keeps every label inside the map", async ({ page }) => {
      await page.goto("/regions/");
      const outside = await page.locator(".map-layout .plot svg").evaluate((svg) => {
        const box = svg.getBoundingClientRect();
        return [...svg.querySelectorAll("text")]
          .map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() }))
          .filter(({ r }) => r.left < box.left - 0.5 || r.right > box.right + 0.5)
          .map(({ text }) => text);
      });
      expect(outside).toEqual([]);
    });

    test("keeps every label off the peak triangles", async ({ page }) => {
      await page.goto("/regions/");
      const covering = await page.locator(".map-layout .plot svg").evaluate((svg) => {
        // A peak's triangle carries its name as a <title>; a city's dot carries "<city>, <region>".
        const peaks = [...svg.querySelectorAll("path")]
          .filter((p) => p.querySelector("title") && !(p.querySelector("title")!.textContent ?? "").includes(","))
          .map((p) => ({ name: p.querySelector("title")!.textContent, r: p.getBoundingClientRect() }));
        const out: string[] = [peaks.length === 2 ? "" : `found ${peaks.length} peak triangles`].filter(Boolean);
        for (const t of svg.querySelectorAll("text")) {
          const r = t.getBoundingClientRect();
          for (const p of peaks) {
            if (r.left < p.r.right - 0.5 && p.r.left < r.right - 0.5 && r.top < p.r.bottom - 0.5 && p.r.top < r.bottom - 0.5) {
              out.push(`${t.textContent} over ${p.name}`);
            }
          }
        }
        return out;
      });
      expect(covering).toEqual([]);
    });

    // A label's own dot is allowed: at a phone's label size Arvada's and
    // Windsor's labels touch the top of their dots, as on main, and read as
    // those cities'. Without that exception this check reports exactly those
    // two at 375 px and none at 1280 px.
    test("keeps every label off the other labels and off other cities' dots", async ({ page }) => {
      await page.goto("/regions/");
      await page.evaluate(() => document.fonts.ready);
      const problems = await page.locator(".map-layout .plot svg").evaluate((svg) => {
        const hit = (a: DOMRect, b: DOMRect) =>
          a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const labels = [...svg.querySelectorAll("text")].map((t) => ({ text: t.textContent ?? "", r: t.getBoundingClientRect() }));
        // A city's dot carries "<city>, <region>" as its <title>; the region washes carry none.
        const dots = [...svg.querySelectorAll("circle")]
          .filter((c) => c.querySelector("title"))
          .map((c) => ({ city: (c.querySelector("title")!.textContent ?? "").split(",")[0]!, r: c.getBoundingClientRect() }));
        const out: string[] = dots.length === 9 ? [] : [`found ${dots.length} city dots`];
        labels.forEach((a, i) => {
          for (const b of labels.slice(i + 1)) if (hit(a.r, b.r)) out.push(`${a.text} / ${b.text}`);
          for (const d of dots) if (d.city !== a.text && hit(a.r, d.r)) out.push(`${a.text} over ${d.city}`);
        });
        return out;
      });
      expect(problems).toEqual([]);
    });
  });
}

test.describe("/regions/", () => {
  test("shows the three regions in order and the map", async ({ page }) => {
    await page.goto("/regions/");
    await expect(page.getByRole("heading", { level: 1, name: "Regions" })).toBeVisible();
    const links = page.locator("[data-region] h3 a");
    await expect(links).toHaveText(REGIONS.map((r) => r.name));
    await expect(page.getByRole("img", { name: /map of the three colorado startups regions/i })).toBeVisible();
    await page.getByText("Show the data for").click();
    await expect(page.locator("figure.chart tbody tr")).toHaveCount(3);
  });
});

for (const region of REGIONS) {
  test.describe(`/regions/${region.id}/`, () => {
    test("shows the organizer seat and opens a resource stage", async ({ page }) => {
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

      const stage = page.locator("details.stage").first();
      await expect(stage.locator("li[data-city]").first()).toBeHidden();
      await stage.locator("summary").click();
      await expect(stage.locator("li[data-city]").first()).toBeVisible();
    });
  });
}

for (const path of PAGES) {
  test(`${path} passes axe`, async ({ page }) => {
    await page.goto(path);
    // Open every stage so axe checks the lists too.
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
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

// Every map label draws at 15 px or more: its computed size times the SVG's
// shown width over its viewBox width (#329).
for (const width of [360, 375, 480, 1280]) {
  test.describe(`/regions/ map text at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("draws every label at 15 px or more", async ({ page }) => {
      await page.goto("/regions/");
      const small = await page.locator(".map-layout .plot svg").evaluate((svg) => {
        const k = svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width;
        return [...svg.querySelectorAll("text")]
          .map((t) => ({ text: t.textContent, drawn: parseFloat(getComputedStyle(t).fontSize) * k }))
          .filter((t) => t.drawn < 14.95)
          .map((t) => `${t.text} ${t.drawn.toFixed(1)} px`);
      });
      expect(small).toEqual([]);
    });
  });
}
