// Step P3a over the built site (run `npm run build` first; test:content
// does): /get-featured/ shows an example card marked as an example, renders
// the fields the Worker parses, each with its label, leaves both consent
// boxes unticked, and stays noindex and out of the sitemap until P3b links
// it. The thanks page promises no spot. Fixtures are the page's own made-up
// example values.
import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import {
  SPOTLIGHT_CONSENT,
  SPOTLIGHT_EXAMPLE,
  SPOTLIGHT_FIELDS as F,
  SPOTLIGHT_LIMITS,
} from "../../../src/components/spotlight/fields";
import { axeViolations } from "../l9/axe";
import { readDist, sitemapPaths } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("/get-featured/", () => {
  const source = readDist("get-featured/index.html");
  const page = doc(source);
  const formEl = page.querySelector<HTMLFormElement>("form[data-spotlight-form]")!;
  const control = (name: string) => formEl.querySelector<HTMLInputElement>(`[name='${name}']`);
  const labelOf = (name: string) => text(formEl.querySelector(`label[for='${control(name)?.id}']`));

  it("posts to /api/spotlight with the speed stamp and the honeypot", () => {
    expect(formEl.getAttribute("action")).toBe("/api/spotlight");
    expect(formEl.getAttribute("method")).toBe("post");
    expect(formEl.querySelector("input[type='hidden'][name='ts']")).not.toBeNull();
    expect(formEl.querySelector(".hp[aria-hidden='true'] input[name='website']")?.getAttribute("tabindex")).toBe("-1");
  });

  it("ties a label to every field", () => {
    const labels = {
      [F.firstName]: "First name",
      [F.lastName]: "Last name",
      [F.email]: "Email",
      [F.role]: "Your role",
      [F.linkedin]: "LinkedIn profile (optional)",
      [F.company]: "Company name",
      [F.companyWebsite]: "Company website",
      [F.city]: "City or region in Colorado",
      [F.building]: "What you are building, in one line",
      [F.founder]: SPOTLIGHT_CONSENT.founder,
      [F.consentShow]: SPOTLIGHT_CONSENT.show,
    };
    for (const [name, label] of Object.entries(labels)) expect(labelOf(name), name).toBe(label);
  });

  it("requires every field but LinkedIn, and caps the line at 140 characters", () => {
    for (const name of Object.values(F).filter((n) => n !== F.linkedin)) {
      expect(control(name)?.hasAttribute("required"), name).toBe(true);
    }
    expect(control(F.linkedin)?.hasAttribute("required")).toBe(false);
    expect(control(F.building)?.getAttribute("maxlength")).toBe(String(SPOTLIGHT_LIMITS.building));
  });

  it("leaves both consent boxes unticked", () => {
    for (const name of [F.founder, F.consentShow]) {
      const box = control(name)!;
      expect(box.type, name).toBe("checkbox");
      expect(box.hasAttribute("checked"), name).toBe(false);
    }
  });

  it("fills in names, email and the organization by autocomplete", () => {
    expect(control(F.firstName)?.getAttribute("autocomplete")).toBe("given-name");
    expect(control(F.lastName)?.getAttribute("autocomplete")).toBe("family-name");
    expect(control(F.email)?.getAttribute("autocomplete")).toBe("email");
    expect(control(F.company)?.getAttribute("autocomplete")).toBe("organization");
  });

  it("says the email is never shown, and names the button for what it does", () => {
    expect(text(page.getElementById(control(F.email)?.getAttribute("aria-describedby") ?? ""))).toContain(
      "It is never shown.",
    );
    expect(text(formEl.querySelector("button[type='submit']"))).toBe("Ask to be featured");
    expect(text(page.getElementById(formEl.getAttribute("aria-describedby") ?? ""))).toBe(
      "A person reviews every request. Sending this does not guarantee a spot. Your email is never shown.",
    );
  });

  it("shows an example card, marked as an example, built from the form's example values", () => {
    const card = page.querySelector("[data-example-card]")!;
    expect(card).not.toBeNull();
    const figure = card.closest("figure")!;
    expect(text(card)).toContain("Example");
    expect(text(figure.querySelector("figcaption"))).toContain("Example card.");
    for (const value of [SPOTLIGHT_EXAMPLE.name, SPOTLIGHT_EXAMPLE.role, SPOTLIGHT_EXAMPLE.company, SPOTLIGHT_EXAMPLE.building]) {
      expect(text(card)).toContain(value);
    }
    expect(SPOTLIGHT_EXAMPLE.company).toContain("Example");
    // An example links nowhere.
    expect(card.querySelector("a")).toBeNull();
    expect(text(formEl)).toContain(SPOTLIGHT_EXAMPLE.building);
  });

  it("names no ranking, no Leaderboard and no counts", () => {
    const main = text(page.querySelector("main"));
    expect(main).not.toMatch(/\brank|leaderboard|\bmembers\b/i);
    expect((main.match(/!/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("carries one alert per error code, hidden until the Worker sends one back", () => {
    const codes = [...page.querySelectorAll<HTMLElement>("[data-error]")].map((e) => e.dataset.error);
    expect(codes).toEqual(["invalid", "verification", "ratelimit", "delivery", "unavailable"]);
    for (const el of page.querySelectorAll("[data-error]")) {
      expect(el.getAttribute("role")).toBe("alert");
      expect(el.hasAttribute("hidden")).toBe(true);
    }
  });

  it("stays out of search and out of the sitemap until P3b", () => {
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
    expect(page.querySelector("link[rel='canonical']")).toBeNull();
    expect(sitemapPaths()).not.toContain("/get-featured/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

describe("/get-featured/thanks/", () => {
  const source = readDist("get-featured/thanks/index.html");
  const page = doc(source);

  it("says a person reads it, promises no spot, and links the LinkedIn Group and events", () => {
    expect(text(page.querySelector("h1"))).toBe("Thank you");
    expect(text(page.querySelector("main"))).toContain("Sending it does not guarantee a spot.");
    const hrefs = [...page.querySelectorAll<HTMLAnchorElement>("main a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(WAYS_IN["linkedin-group"]);
    expect(hrefs).toContain(WAYS_IN.events);
  });

  it("stays out of search and out of the sitemap", () => {
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
    expect(sitemapPaths()).not.toContain("/get-featured/thanks/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});
