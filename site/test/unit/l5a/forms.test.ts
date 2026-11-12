// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { showErrorMessage, stampLoadTime } from "../../../src/components/forms/form-status";

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
