// L19: the seat application form in a real browser, against the built static
// site. scripts/serve-dist.mjs serves dist/ with no Worker, so these specs
// answer POST /api/apply with page.route() the way the Worker does (a 303),
// and stub Turnstile's script so no test reaches Cloudflare. The POST contract
// itself is proven in test/worker/l19/apply.test.ts. Fixtures use invented
// names, example.org addresses and made-up Academy verification codes.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Request, test } from "@playwright/test";

const FORM = "/get-involved/apply/";
const THANKS = "/get-involved/apply/thanks/";

const course = (page: Page, id: string) => page.locator(`[data-course='${id}']`);

async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
}

// Answers the form post the way the Worker would, and keeps the request.
async function answerPost(page: Page, location: string): Promise<Request[]> {
  const posts: Request[] = [];
  await page.route("**/api/apply", (route) => {
    posts.push(route.request());
    return route.fulfill({ status: 303, headers: { Location: location } });
  });
  return posts;
}

async function fillApplication(page: Page) {
  await page.getByLabel("Why are you excited about this seat?").fill("I go to every founder event in town.");
  await page.getByLabel("Your name", { exact: true }).fill("Test Applicant");
  await page.getByLabel("Your email", { exact: true }).fill("applicant@example.org");
  await page.getByLabel("Where you are based").fill("Colorado Springs");
  let n = 0;
  for (const input of await page.locator("[data-course]:not([hidden]) input").all()) {
    await input.fill(`https://academy.claude.com/verify/TEST-000${++n}`);
  }
  await page.getByLabel("Colorado Startups will contact me about this seat only.").check();
}

test.describe("/get-involved/apply/", () => {
  test("preselects the seat from ?role= and shows only its courses", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(`${FORM}?role=space-peak-connector`);
    await expect(page.getByLabel("Seat", { exact: true })).toHaveValue("space-peak-connector");
    for (const id of ["claude-101", "ai-fluency-framework-foundations", "ai-fluency-for-small-businesses"]) {
      await expect(course(page, id)).toBeVisible();
      await expect(course(page, id).locator("input")).toHaveAttribute("required", "");
    }
    await expect(course(page, "building-effective-human-agent-teams")).toBeHidden();
    await expect(course(page, "building-effective-human-agent-teams").locator("input")).toBeDisabled();
  });

  test("swaps the course fields when the seat changes", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(`${FORM}?role=fusion-canyon-connector`);
    await page.getByLabel("Seat", { exact: true }).selectOption("slack-community-lead");
    await expect(course(page, "building-effective-human-agent-teams")).toBeVisible();
    await expect(course(page, "ai-fluency-for-small-businesses")).toBeHidden();
    await expect(course(page, "claude-101")).toBeVisible();
  });

  test("shows no course until a seat is chosen, and ignores an unknown ?role=", async ({ page }) => {
    await stubTurnstile(page);
    // An old seat id, kept to prove an old link preselects nothing (review item 8).
    await page.goto(`${FORM}?role=slack-moderator`);
    await expect(page.getByLabel("Seat", { exact: true })).toHaveValue("");
    await expect(page.locator("[data-courses-empty]")).toBeVisible();
    await expect(page.locator("[data-course]:visible")).toHaveCount(0);
  });

  test("stamps the load time for the speed check", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(FORM);
    const ts = Number(await page.locator("input[name=ts]").inputValue());
    expect(ts).toBeGreaterThan(Date.now() - 60_000);
  });

  test("submits the chosen seat's fields and lands on the thanks page", async ({ page }) => {
    await stubTurnstile(page);
    const posts = await answerPost(page, THANKS);
    await page.goto(`${FORM}?role=space-peak-connector`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Send my application" }).click();

    await expect(page).toHaveURL(new RegExp(`${THANKS}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank you");
    // The thanks page drops this tab's draft of the application. Its script
    // can run after the heading shows, so wait for the draft to go (#356, #357).
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("cs-apply-draft"))).toBeNull();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const body = posts[0]!.postData() ?? "";
    expect(body).toMatch(/name="role"\r\n\r\nspace-peak-connector\r\n/);
    expect(body).toContain('name="badge_ai-fluency-for-small-businesses"');
    expect(body).not.toContain('name="badge_building-effective-human-agent-teams"');
    expect(body).toMatch(/name="consent"\r\n\r\non\r\n/);
  });

  test("comes back from the invalid redirect with the seat selected and the message shown", async ({ page }) => {
    await stubTurnstile(page);
    await answerPost(page, `${FORM}?role=space-peak-connector&error=invalid`);
    await page.goto(`${FORM}?role=space-peak-connector`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Send my application" }).click();

    await expect(page).toHaveURL(/\/get-involved\/apply\/\?role=space-peak-connector&error=invalid$/);
    const message = page.locator('[data-error="invalid"]');
    await expect(message).toBeVisible();
    await expect(message).toBeFocused();
    await expect(page.locator('[data-error="verification"]')).toBeHidden();
    await expect(page.getByLabel("Seat", { exact: true })).toHaveValue("space-peak-connector");

    // The answers come back from this tab's sessionStorage; consent is ticked again on purpose.
    await expect(page.getByLabel("Why are you excited about this seat?")).toHaveValue("I go to every founder event in town.");
    await expect(page.getByLabel("Your name", { exact: true })).toHaveValue("Test Applicant");
    await expect(page.getByLabel("Your email", { exact: true })).toHaveValue("applicant@example.org");
    await expect(course(page, "ai-fluency-for-small-businesses").locator("input")).toHaveValue(
      "https://academy.claude.com/verify/TEST-0003",
    );
    await expect(page.getByLabel("Colorado Startups will contact me about this seat only.")).not.toBeChecked();
  });

  test("starts clean on a visit with no error, dropping an old draft", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(`${FORM}?role=space-peak-connector`);
    await page.evaluate(() => sessionStorage.setItem("cs-apply-draft", JSON.stringify({ name: "Old Draft" })));
    await page.reload();
    await expect(page.getByLabel("Your name", { exact: true })).toHaveValue("");
    // The form's script drops the old draft. Wait for that, as the thanks test does.
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("cs-apply-draft"))).toBeNull();
  });

  test("shows nothing for an unknown ?error= code", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(`${FORM}?error=<img>`);
    await expect(page.locator("[data-error]:visible")).toHaveCount(0);
  });

  test("stops an http badge link in the browser, before anything is sent", async ({ page }) => {
    await stubTurnstile(page);
    const posts = await answerPost(page, THANKS);
    await page.goto(`${FORM}?role=space-peak-connector`);
    await fillApplication(page);
    const first = course(page, "claude-101").locator("input");
    await first.fill("http://academy.claude.com/verify/TEST-0001");
    await page.getByRole("button", { name: "Send my application" }).click();
    expect(await first.evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true);
    await expect(page).toHaveURL(/\?role=space-peak-connector$/);
    expect(posts).toHaveLength(0);
  });

  test("stops a badge link on a lookalike host in the browser", async ({ page }) => {
    await stubTurnstile(page);
    const posts = await answerPost(page, THANKS);
    await page.goto(`${FORM}?role=space-peak-connector`);
    await fillApplication(page);
    const first = course(page, "claude-101").locator("input");
    await first.fill("https://academy.claude.com.evil.example/verify/1");
    await page.getByRole("button", { name: "Send my application" }).click();
    expect(await first.evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true);
    expect(posts).toHaveLength(0);
  });

  test("hides the honeypot from people", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(FORM);
    await expect(page.locator("input[name=website]")).not.toBeInViewport();
  });
});

for (const width of [1280, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of [`${FORM}?role=slack-community-lead`, THANKS]) {
      test(`${path} passes axe and fits the screen`, async ({ page }) => {
        await stubTurnstile(page);
        await page.goto(path);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
