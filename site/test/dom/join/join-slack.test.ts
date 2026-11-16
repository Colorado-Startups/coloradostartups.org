// Step P5a over the built site (run `npm run build` first; test:content
// does): /join/slack/ renders the fields the Worker parses, each with its
// label, stays noindex and out of the sitemap until P5b, and the thanks page
// links the LinkedIn Group and the events page from WAYS_IN.
import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { BASED_CHOICES, DESCRIBES_CHOICES, HEARD_CHOICES, JOIN_FIELDS as F } from "../../../src/components/join/fields";
import { axeViolations } from "../l9/axe";
import { readDist, sitemapPaths } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("/join/slack/", () => {
  const source = readDist("join/slack/index.html");
  const page = doc(source);
  const formEl = page.querySelector<HTMLFormElement>("form[data-join-form]")!;
  const control = (name: string) => formEl.querySelector<HTMLInputElement | HTMLSelectElement>(`[name='${name}']`);
  const labelOf = (name: string) => text(formEl.querySelector(`label[for='${control(name)?.id}']`));

  it("posts to /api/join with the speed stamp and the honeypot", () => {
    expect(formEl.getAttribute("action")).toBe("/api/join");
    expect(formEl.getAttribute("method")).toBe("post");
    expect(formEl.querySelector("input[type='hidden'][name='ts']")).not.toBeNull();
    expect(formEl.querySelector(".hp[aria-hidden='true'] input[name='website']")?.getAttribute("tabindex")).toBe("-1");
  });

  it("ties a label to every field", () => {
    const labels = {
      [F.firstName]: "First name",
      [F.lastName]: "Last name",
      [F.email]: "Email",
      [F.linkedin]: "LinkedIn profile",
      [F.based]: "Where are you based?",
      [F.city]: "City or region",
      [F.describes]: "What best describes you?",
      [F.heard]: "How did you hear about Colorado Startups? (optional)",
      [F.newsletter]: "Send me the Colorado Startups newsletter. Unsubscribe anytime.",
    };
    for (const [name, label] of Object.entries(labels)) expect(labelOf(name), name).toBe(label);
  });

  it("requires what the Google Form required, and leaves the rest optional", () => {
    for (const name of [F.firstName, F.lastName, F.email, F.linkedin, F.based, F.describes]) {
      expect(control(name)?.hasAttribute("required"), name).toBe(true);
    }
    // The page script requires the city once "Colorado" is chosen.
    for (const name of [F.city, F.heard, F.newsletter]) expect(control(name)?.hasAttribute("required"), name).toBe(false);
  });

  it("leaves the newsletter box unticked", () => {
    const box = control(F.newsletter) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.hasAttribute("checked")).toBe(false);
  });

  it("offers each choice list in the Google Form's order", () => {
    const options = (name: string) => [...formEl.querySelectorAll<HTMLOptionElement>(`select[name='${name}'] option`)].map((o) => o.value);
    expect(options(F.based)).toEqual(["", ...BASED_CHOICES.map(([id]) => id)]);
    expect(options(F.describes)).toEqual(["", ...DESCRIBES_CHOICES.map(([id]) => id)]);
    expect(options(F.heard)).toEqual(["", ...HEARD_CHOICES.map(([id]) => id)]);
  });

  it("says where the invite goes and why LinkedIn is asked", () => {
    const hint = (name: string) => text(page.getElementById(control(name)?.getAttribute("aria-describedby") ?? ""));
    expect(hint(F.email)).toBe("Your Slack invite goes to this address.");
    expect(hint(F.linkedin)).toContain("It helps us check you are a real person in the ecosystem.");
  });

  it("says a person reviews every request, and names the button for what it does", () => {
    expect(text(page.querySelector("main"))).toContain("A person reviews every request before an invite is sent.");
    expect(text(formEl.querySelector("button[type='submit']"))).toBe("Request an invite");
  });

  it("carries one alert per error code, hidden until the Worker sends one back", () => {
    const codes = [...page.querySelectorAll<HTMLElement>("[data-error]")].map((e) => e.dataset.error);
    expect(codes).toEqual(["invalid", "verification", "ratelimit", "delivery", "unavailable"]);
    for (const el of page.querySelectorAll("[data-error]")) {
      expect(el.getAttribute("role")).toBe("alert");
      expect(el.hasAttribute("hidden")).toBe(true);
    }
  });

  it("stays out of search and out of the sitemap until P5b", () => {
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
    expect(page.querySelector("link[rel='canonical']")).toBeNull();
    expect(sitemapPaths()).not.toContain("/join/slack/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

describe("/join/slack/thanks/", () => {
  const source = readDist("join/slack/thanks/index.html");
  const page = doc(source);

  it("says what happens next and links the LinkedIn Group and events", () => {
    expect(text(page.querySelector("h1"))).toBe("Thank you");
    const hrefs = [...page.querySelectorAll<HTMLAnchorElement>("main a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(WAYS_IN["linkedin-group"]);
    expect(hrefs).toContain(WAYS_IN.events);
  });

  it("stays out of search and out of the sitemap", () => {
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
    expect(sitemapPaths()).not.toContain("/join/slack/thanks/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});
