// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { newsletterCopy } from "../../../src/components/newsletter/copy";
import { initNewsletterForms } from "../../../src/components/newsletter/signup";
import { track } from "../../../src/lib/track";
import type { FormError } from "../../../worker/lib/forms";

vi.mock("../../../src/lib/track", () => ({ track: vi.fn(() => true) }));

// Every code the Worker can send back has a message, and nothing more. The
// Record type fails to compile when the two lists drift.
const WORKER_CODES: Record<FormError, true> = {
  invalid: true,
  verification: true,
  ratelimit: true,
  delivery: true,
  unavailable: true,
};

describe("newsletter copy", () => {
  it("has exactly one message per Worker error code", () => {
    expect(Object.keys(newsletterCopy.errors).sort()).toEqual(Object.keys(WORKER_CODES).sort());
  });
  it("uses the Startupers name and the decision 23 description", () => {
    expect(newsletterCopy.title).toBe("Get Startupers");
    expect(newsletterCopy.description).toBe(
      "Colorado founders, startups and builders: wins, lessons and events from the Colorado Startups community.",
    );
  });
});

function page(returnTo: string): Document {
  document.body.innerHTML = `
    <form data-newsletter data-return-to="${returnTo}" data-submit-event="newsletter_submit">
      <input name="email" /><input name="ts" value="" />
      ${Object.keys(newsletterCopy.errors).map((c) => `<p data-error="${c}" hidden></p>`).join("")}
    </form>`;
  return document;
}
const shown = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>("[data-error]")].filter((e) => !e.hidden).map((e) => e.dataset.error);

describe("initNewsletterForms", () => {
  it("stamps the load time", () => {
    const doc = page("/");
    initNewsletterForms(doc, { pathname: "/", search: "" });
    expect(Number(doc.querySelector<HTMLInputElement>('[name="ts"]')!.value)).toBeGreaterThan(0);
  });
  it("shows the message for a known code on this page's form", () => {
    const doc = page("/community/");
    initNewsletterForms(doc, { pathname: "/community/", search: "?error=delivery" });
    expect(shown(doc)).toEqual(["delivery"]);
    expect(doc.querySelector('[name="email"]')!.getAttribute("aria-invalid")).toBe("true");
  });
  it("stays quiet for an unknown code or another page's form", () => {
    const doc = page("/community/");
    initNewsletterForms(doc, { pathname: "/community/", search: '?error="]x' });
    initNewsletterForms(doc, { pathname: "/", search: "?error=invalid" });
    expect(shown(doc)).toEqual([]);
  });

  // M1c: a rejection sends newsletter_submit with ok false; track() is mocked.
  it("sends newsletter_submit with ok false for a rejection on this page's form, and nothing otherwise", () => {
    vi.mocked(track).mockClear();
    const doc = page("/newsletter/");
    initNewsletterForms(doc, { pathname: "/newsletter/", search: "" });
    initNewsletterForms(doc, { pathname: "/", search: "?error=invalid" });
    expect(track).not.toHaveBeenCalled();
    initNewsletterForms(doc, { pathname: "/newsletter/", search: "?error=ratelimit" });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("newsletter_submit", { where: "newsletter", ok: false });
  });
});
