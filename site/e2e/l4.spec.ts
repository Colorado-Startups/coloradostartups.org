// L4 Resourcus panel in a real browser (OWASP LLM05, improper output
// handling). /api/ask and Turnstile are mocked, so this runs against the
// static build with no Worker, no model and no network.
//
// The static counterpart is test/unit/l4/panel-sinks.test.ts.

import { expect, test, type Page, type Request } from "@playwright/test";

const XSS = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;

const card = (id: string, name: string, url: string, description: string) => ({
  id,
  name,
  url,
  stage: "launch",
  substage: "develop",
  city: "Denver",
  type: "coworking",
  description,
});

const HOSTILE = {
  answer: `Try these. ${XSS} Done.`,
  citations: ["fx-a", "fx-b"],
  resources: [
    card("fx-a", `Evil ${XSS}`, "javascript:window.__xss=3", `About ${XSS}`),
    card("fx-b", "Good Place", "https://example.org/good", "Shared desks."),
  ],
  mode: "model",
  reason: "ok",
};

const FALLBACK = {
  answer: "Here are the closest matches in Startup Resources.",
  citations: ["fx-b"],
  resources: [card("fx-b", "Good Place", "https://example.org/good", "Shared desks.")],
  mode: "fallback",
  reason: "budget",
};

// A stand-in for Turnstile's explicit-render API that hands out a token.
const TURNSTILE_STUB = `window.turnstile = {
  render: (el, o) => { window.__ts = o; return "w1"; },
  execute: () => window.__ts.callback("stub-token"),
  reset: () => {},
};`;

async function mockApi(page: Page, replies: { status: number; body: unknown }[]): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route("**/api/ask", async (route) => {
    seen.push(route.request());
    const next = replies.shift() ?? { status: 500, body: {} };
    await route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify(next.body) });
  });
  return seen;
}

async function ask(page: Page, question: string) {
  const panel = page.locator("[data-resourcus]").first();
  await panel.getByLabel("Your question").fill(question);
  await panel.getByRole("button", { name: "Ask Resourcus" }).click();
  return panel;
}

// Cloudflare's documented always-pass test site key. Injected into the served
// page so the Turnstile path runs whether or not the build had a key.
const TEST_SITE_KEY = "1x00000000000000000000AA";

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/data-sitekey(="[^"]*")?(?=[\s>])/g, `data-sitekey="${TEST_SITE_KEY}"`);
      await route.fulfill({ response: res, body });
    },
  );
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }),
  );
  page.on("dialog", (d) => {
    throw new Error(`a dialog opened: ${d.message()}`);
  });
});

test("model text and card fields render as text, never as HTML", async ({ page }) => {
  await mockApi(page, [{ status: 200, body: HOSTILE }]);
  await page.goto("/");
  const panel = await ask(page, "Where can I cowork?");
  const thread = panel.locator("[data-thread]");

  await expect(thread.locator(".resourcus__answer")).toHaveText(`Try these. ${XSS} Done.`);
  await expect(thread.getByRole("heading", { name: `Evil ${XSS}` })).toBeVisible();
  expect(await thread.locator("img, script, iframe").count()).toBe(0);
  expect(await thread.locator('a[href^="javascript"]').count()).toBe(0);
  await expect(thread.getByRole("link", { name: "Good Place" })).toHaveAttribute("href", "https://example.org/good");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("Turnstile runs on the first question of a session only", async ({ page }) => {
  const seen = await mockApi(page, [
    { status: 200, body: FALLBACK },
    { status: 200, body: FALLBACK },
  ]);
  await page.goto("/");
  const panel = await ask(page, "Where can I cowork?");
  await expect(panel.locator(".resourcus__turn")).toHaveCount(1);
  await ask(page, "And in Boulder?");
  await expect(panel.locator(".resourcus__turn")).toHaveCount(2);

  const bodies = seen.map((r) => r.postDataJSON() as Record<string, unknown>);
  expect(bodies[0]!.turnstileToken).toBe("stub-token");
  expect(bodies[1]!.turnstileToken).toBeUndefined();
  expect(bodies[0]!.sessionId).toBe(bodies[1]!.sessionId);
  expect(bodies[1]!.history).toEqual([
    { role: "user", content: "Where can I cowork?" },
    { role: "assistant", content: FALLBACK.answer },
  ]);
});

test("a 403 runs Turnstile again and retries once", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.setItem("resourcus.verified", "yes"));
  const seen = await mockApi(page, [
    { status: 403, body: { error: "verification" } },
    { status: 200, body: FALLBACK },
  ]);
  const panel = await ask(page, "Where can I cowork?");
  await expect(panel.locator(".resourcus__turn")).toHaveCount(1);
  const bodies = seen.map((r) => r.postDataJSON() as Record<string, unknown>);
  expect(bodies[0]!.turnstileToken).toBeUndefined();
  expect(bodies[1]!.turnstileToken).toBe("stub-token");
});

test("a fallback answer explains itself and offers keyword search of the site", async ({ page }) => {
  await mockApi(page, [{ status: 200, body: FALLBACK }]);
  await page.goto("/");
  const panel = await ask(page, "Colorado Startups");
  await expect(panel.getByText("used this month's budget")).toBeVisible();
  await panel.getByRole("button", { name: "Search the site for these words" }).click();
  const links = panel.locator(".resourcus__links a");
  await expect(links.first()).toBeVisible();
  for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href.startsWith("/")).toBe(true);
    expect(href).not.toMatch(/^\/404/);
  }
});

test("rate limits and errors show a plain message", async ({ page }) => {
  await mockApi(page, [{ status: 429, body: { error: "rate-limit" } }]);
  await page.goto("/");
  const panel = await ask(page, "Where can I cowork?");
  await expect(panel.locator("[data-status]")).toHaveText("You are asking quickly. Wait a minute, then ask again.");
});

test("the panel discloses that Resourcus is an AI agent", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-resourcus] .ai-note")).toContainText(
    "Resourcus is an AI agent run by Colorado Startups",
  );
});
