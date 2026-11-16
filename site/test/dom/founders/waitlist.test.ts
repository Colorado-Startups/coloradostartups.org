// Step F1 over the built site (run `npm run build` first; test:content does):
// /founders/ holds the waitlist form, which renders the fields the Worker
// parses, each with its label; the thanks page is noindex, out of the
// sitemap, and links the Slack and events from WAYS_IN.
import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import {
  WAITLIST_FIELDS as F,
  WAITLIST_STAGES,
  WAITLIST_THANKS_PATH,
} from "../../../src/components/founders/waitlist-fields";
import { axeViolations } from "../l9/axe";
import { readDist, sitemapPaths } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the /founders/ waitlist form", () => {
  const page = doc(readDist("founders/index.html"));
  const section = page.getElementById("waitlist")!;
  const formEl = section.querySelector<HTMLFormElement>("form[data-waitlist-form]")!;
  const control = (name: string) => formEl.querySelector<HTMLInputElement | HTMLSelectElement>(`[name='${name}']`);
  const labelOf = (name: string) => text(formEl.querySelector(`label[for='${control(name)?.id}']`));

  it("posts to /api/waitlist with the speed stamp and the honeypot", () => {
    expect(formEl.getAttribute("action")).toBe("/api/waitlist");
    expect(formEl.getAttribute("method")).toBe("post");
    expect(formEl.querySelector("input[type='hidden'][name='ts']")).not.toBeNull();
    expect(formEl.querySelector(".hp[aria-hidden='true'] input[name='website']")?.getAttribute("tabindex")).toBe("-1");
  });

  it("sits under a heading that says what it is", () => {
    expect(text(section.querySelector("h2"))).toBe("Join the waitlist");
  });

  it("ties a label to every field", () => {
    const labels = {
      [F.firstName]: "First name",
      [F.lastName]: "Last name",
      [F.email]: "Email",
      [F.company]: "Company name",
      [F.companyWebsite]: "Company website (optional)",
      [F.stage]: "Stage (optional)",
      [F.founder]: "I am a founder or cofounder of a company in Colorado",
    };
    for (const [name, label] of Object.entries(labels)) expect(labelOf(name), name).toBe(label);
  });

  it("requires the names, email, company and the founder box, and leaves website and stage optional", () => {
    for (const name of [F.firstName, F.lastName, F.email, F.company, F.founder]) {
      expect(control(name)?.hasAttribute("required"), name).toBe(true);
    }
    for (const name of [F.companyWebsite, F.stage]) expect(control(name)?.hasAttribute("required"), name).toBe(false);
    const box = control(F.founder) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.hasAttribute("checked")).toBe(false);
  });

  it("offers the company stages, and no newsletter box", () => {
    const options = [...formEl.querySelectorAll<HTMLOptionElement>(`select[name='${F.stage}'] option`)].map((o) => o.value);
    expect(options).toEqual(["", ...WAITLIST_STAGES]);
    expect(formEl.querySelector("[name='newsletter']")).toBeNull();
  });

  it("names the button for what it does, and says under it what happens and how long we keep the details", () => {
    expect(text(formEl.querySelector("button[type='submit']"))).toBe("Join the waitlist");
    expect(text(page.getElementById(formEl.getAttribute("aria-describedby") ?? ""))).toBe(
      "We email you once, when the forum opens. We keep your details for up to 12 months. If it has not opened by then, join again.",
    );
  });

  it("says joining is not admission, and that we check people are founders when it opens", () => {
    expect(text(section)).toContain("Joining the waitlist is not admission.");
    expect(text(section)).toContain("When the forum opens, we check that each person on it is a founder.");
  });

  it("carries one alert per error code, hidden until the Worker sends one back", () => {
    const codes = [...section.querySelectorAll<HTMLElement>("[data-error]")].map((e) => e.dataset.error);
    expect(codes).toEqual(["invalid", "verification", "ratelimit", "delivery", "unavailable"]);
    for (const el of section.querySelectorAll("[data-error]")) {
      expect(el.getAttribute("role")).toBe("alert");
      expect(el.hasAttribute("hidden")).toBe(true);
    }
  });
});

describe("/founders/waitlist/thanks/", () => {
  const source = readDist("founders/waitlist/thanks/index.html");
  const page = doc(source);

  it("says what happens next and links the Slack and events", () => {
    expect(text(page.querySelector("h1"))).toBe("Thank you");
    expect(text(page.querySelector("main"))).toContain("We email you once, when the forum opens.");
    const hrefs = [...page.querySelectorAll<HTMLAnchorElement>("main a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(WAYS_IN.slack);
    expect(hrefs).toContain(WAYS_IN.events);
  });

  it("stays out of search and out of the sitemap", () => {
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
    expect(sitemapPaths()).not.toContain(WAITLIST_THANKS_PATH);
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});
