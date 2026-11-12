import { expect, test } from "@playwright/test";

// L5b: each page's main action sits in the first screen, at a phone's and a
// laptop's size, before any scroll (#218, #723, #724). The design and
// usability reviews found each one below the fold.

const PAGES = [
  { route: "/founders/", action: { role: "link", name: "Join the Slack" } },
  { route: "/regions/photon-mountain/", action: { role: "link", name: "Join the Slack" } },
  { route: "/regions/space-peak/", action: { role: "link", name: "Join the Slack" } },
  { route: "/regions/fusion-canyon/", action: { role: "link", name: "Join the Slack" } },
  { route: "/newsletter/", action: { role: "button", name: "Subscribe" } },
  { route: "/get-involved/apply/", action: { role: "link", name: "Start your application" } },
  // #723 and #724: the calendar's two ways in, and the directory's own task.
  { route: "/event-calendar/", action: { role: "link", name: "See our events on Luma" } },
  { route: "/event-calendar/", action: { role: "link", name: "Add to Google Calendar" } },
  { route: "/ecosystem-canvas/", action: { role: "link", name: "Find a resource" } },
] as const;

const SCREENS = [
  { name: "phone", width: 375, height: 812 },
  { name: "laptop", width: 1280, height: 800 },
];

for (const screen of SCREENS) {
  test.describe(`first screen at ${screen.name} size`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    for (const { route, action } of PAGES) {
      test(`${route}: "${action.name}" shows without a scroll`, async ({ page }) => {
        await page.goto(route);
        const target = page.locator("main").getByRole(action.role, { name: action.name, exact: true }).first();
        const box = await target.boundingBox();
        expect(box, "the action renders").not.toBeNull();
        expect(box!.y + box!.height).toBeLessThanOrEqual(screen.height);
      });
    }
  });
}

test("/get-involved/apply/: Start your application lands on the form", async ({ page }) => {
  await page.goto("/get-involved/apply/");
  await page.locator("main").getByRole("link", { name: "Start your application" }).click();
  await expect(page).toHaveURL(/#form-title$/);
  await expect(page.locator("#form-title")).toBeInViewport();
});

// #723: the home page's Start here pair, the welcome desk and Ask Resourcus,
// stretches to one height, so both panels end on one line at 1280 px.
test.describe("home Start here pair at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("ends both panels on one line", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const pair = page.locator(".pair").first();
    const [desk, ask] = await Promise.all([pair.locator(".welcome-desk").boundingBox(), pair.locator("[data-resourcus]").boundingBox()]);
    expect(desk && ask).toBeTruthy();
    expect(Math.abs(desk!.y - ask!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(desk!.y + desk!.height - (ask!.y + ask!.height))).toBeLessThanOrEqual(1);
  });
});
