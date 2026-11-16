// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cameFrom,
  showErrorMessage,
  stampLoadTime,
  trackAccepted,
  trackSubmit,
} from "../../../src/components/forms/form-status";
import { track } from "../../../src/lib/track";

vi.mock("../../../src/lib/track", () => ({ track: vi.fn(() => true) }));

// L5a, card "Shared CSS patterns" (#195): the forms share one status helper
// and one set of fieldset, hint and check rules in global.css. Needs no build.

// A path, not a URL: jsdom's URL is not the one node:fs reads.
const src = (file: string) => readFileSync(path.join(__dirname, "../../../src", file), "utf8");

describe("stampLoadTime", () => {
  it("stamps every ts input under the root, and nothing else", () => {
    document.body.innerHTML = `<form><input name="ts" value="" /><input name="email" value="" /></form>`;
    stampLoadTime(document, 1_800_000_000_000);
    expect(document.querySelector<HTMLInputElement>('[name="ts"]')!.value).toBe("1800000000000");
    expect(document.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe("");
  });
});

describe("showErrorMessage", () => {
  beforeEach(() => {
    document.body.innerHTML = `<p data-error="invalid" hidden>Check the fields.</p><p data-error="verification" hidden></p>`;
  });

  it("shows and focuses the one message for a known code (known clean)", () => {
    const message = showErrorMessage(document, "invalid");
    expect(message?.hidden).toBe(false);
    expect(document.activeElement).toBe(message);
    expect(document.querySelector<HTMLElement>('[data-error="verification"]')!.hidden).toBe(true);
  });

  it("lets the caller fill the text in before it shows", () => {
    showErrorMessage(document, "invalid", (m) => (m.textContent = "Check the company name."));
    expect(document.querySelector('[data-error="invalid"]')!.textContent).toBe("Check the company name.");
  });

  it("shows nothing for no code, an unknown code or a selector in the URL (known bad)", () => {
    for (const code of [null, "", "nope", '"],[data-error="invalid']) {
      expect(showErrorMessage(document, code)).toBeNull();
    }
    expect([...document.querySelectorAll<HTMLElement>("[data-error]")].every((m) => m.hidden)).toBe(true);
  });
});

describe("one source for the form rules", () => {
  it("keeps the fieldset, hint and check rules in global.css only", () => {
    const css = src("styles/global.css");
    for (const rule of [/\nfieldset \{/, /\nlegend \{/, /\n\.check \{/, /fieldset > \.hint/]) expect(css).toMatch(rule);
    for (const file of ["components/apply/ApplyForm.astro", "components/leaderboard/NominationForm.astro"]) {
      const style = src(file).split("<style>")[1] ?? "";
      expect(style, file).not.toMatch(/^\s*(fieldset|legend|\.check|\.hint)\s*\{/m);
    }
  });

  it("stamps the load time through the helper in all four forms", () => {
    for (const file of [
      "components/apply/ApplyForm.astro",
      "components/leaderboard/NominationForm.astro",
      "components/canvas/suggest-form.ts",
      "components/newsletter/signup.ts",
    ]) {
      const code = src(file);
      expect(code, file).toMatch(/stampLoadTime\(/);
      expect(code, file).not.toMatch(/\.value = String\((Date\.)?now\(\)\)/);
    }
  });
});

// M1c: a posted form's submit event. track() is mocked, so these check the
// name and props each answer hands it.
describe("trackSubmit", () => {
  beforeEach(() => vi.mocked(track).mockClear());

  it("sends the event the element names, with the form's page as where", () => {
    document.body.innerHTML = `<form data-submit-event="join_submit"></form>`;
    expect(trackSubmit(document.querySelector("form"), "/join/slack/", false)).toBe(true);
    expect(track).toHaveBeenCalledWith("join_submit", { where: "join-slack", ok: false });
  });

  it("sends nothing for an element that names no event", () => {
    document.body.innerHTML = `<form></form>`;
    expect(trackSubmit(document.querySelector("form"), "/join/slack/", false)).toBe(false);
    expect(trackSubmit(null, "/", true)).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("cameFrom", () => {
  const here = { origin: "https://coloradostartups.org", href: "https://coloradostartups.org/join/slack/thanks/" };

  it("names the form's page right after the post", () => {
    expect(cameFrom("https://coloradostartups.org/join/slack/?error=invalid", here, "navigate")).toBe("/join/slack/");
    expect(cameFrom("https://coloradostartups.org/founders/", here, undefined)).toBe("/founders/");
  });

  it("is null for a reload, a back step, another site, no referrer or the page itself (known bad)", () => {
    expect(cameFrom("https://coloradostartups.org/join/slack/", here, "reload")).toBeNull();
    expect(cameFrom("https://coloradostartups.org/join/slack/", here, "back_forward")).toBeNull();
    expect(cameFrom("https://example.org/join/slack/", here, "navigate")).toBeNull();
    expect(cameFrom("", here, "navigate")).toBeNull();
    expect(cameFrom(here.href, here, "navigate")).toBeNull();
  });
});

describe("trackAccepted", () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    document.body.innerHTML = `<section data-submit-event="newsletter_submit"></section>`;
  });
  const here = new URL("https://coloradostartups.org/newsletter/thanks/");

  it("sends the thanks page's event with ok true, where the form was", () => {
    expect(trackAccepted(document, "https://coloradostartups.org/newsletter/", here, "navigate")).toBe(true);
    expect(track).toHaveBeenCalledWith("newsletter_submit", { where: "newsletter", ok: true });
  });

  it("sends nothing on a reload or from another site", () => {
    expect(trackAccepted(document, "https://coloradostartups.org/newsletter/", here, "reload")).toBe(false);
    expect(trackAccepted(document, "https://example.org/", here, "navigate")).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it("is wired into each thanks page and each form's rejection", () => {
    for (const file of ["pages/join/slack/thanks.astro", "pages/founders/waitlist/thanks.astro", "pages/newsletter/thanks.astro"]) {
      expect(src(file), file).toMatch(/trackAccepted\(\)/);
    }
    for (const file of ["components/join/SlackJoinForm.astro", "components/founders/WaitlistForm.astro", "components/newsletter/signup.ts"]) {
      expect(src(file), file).toMatch(/trackSubmit\([^)]*false\)/);
    }
  });
});
