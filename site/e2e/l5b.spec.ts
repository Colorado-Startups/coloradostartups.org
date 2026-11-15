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
  // Step F (2026-11-15): the directory opens on its search box.
  { route: "/ecosystem-canvas/", action: { role: "searchbox", name: "Search" } },
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
