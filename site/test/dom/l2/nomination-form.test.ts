// /leaderboard/nominate/ over the built site (run `npm run build` first;
// test:content does): the fields that accept a bare web address and the
// revenue formats (#138, #132), the draft spec the page script reads, and the
// invalid-field marking a rejection triggers.
import { describe, expect, it } from "vitest";

import { clearNamedDrafts, markInvalidFields } from "../../../src/components/apply/client";
import {
  NOMINATION_DRAFT,
  NOMINATION_FIELDS as F,
  USD_PATTERN,
  WEBSITE_PATTERN,
} from "../../../src/lib/leaderboard/nomination";
import { PLACE_COUNTIES } from "../../../src/lib/leaderboard/place-counties";
import { readDist } from "../pages";

const page = () => new DOMParser().parseFromString(readDist("leaderboard/nominate/index.html"), "text/html");

describe("/leaderboard/nominate/", () => {
  const doc = page();
  const form = doc.querySelector<HTMLFormElement>("form[data-nomination-form]")!;
  const field = (name: string) => form.querySelector<HTMLInputElement>(`[name='${name}']`)!;

  it("takes a website typed without https://", () => {
    const site = field(F.website);
    expect(site.getAttribute("type")).toBe("text");
    expect(site.getAttribute("inputmode")).toBe("url");
    expect(site.getAttribute("autocomplete")).toBe("url");
    expect(site.getAttribute("pattern")).toBe(WEBSITE_PATTERN);
    expect(site.hasAttribute("required")).toBe(true);
  });

  it("checks both revenue fields against the formats the Worker accepts", () => {
    for (const name of [F.baseYearRevenue, F.currentYearRevenue]) {
      expect(field(name).getAttribute("pattern"), name).toBe(USD_PATTERN);
      expect(field(name).getAttribute("title"), name).toBe("Whole US dollars, like 1,200,000");
    }
  });

  it("renders the draft spec from NOMINATION_DRAFT, which skips revenue and the boxes", () => {
    expect(form.dataset.draftKey).toBe(NOMINATION_DRAFT.key);
    expect(new Set(form.dataset.draftSkip?.split(" "))).toEqual(new Set(NOMINATION_DRAFT.skip));
    for (const name of [F.baseYearRevenue, F.currentYearRevenue, F.fteHeadcount, F.consentToPublish, F.attestation]) {
      expect(NOMINATION_DRAFT.skip.has(name), name).toBe(true);
    }
  });

  it("carries the message that names the fields to fix", () => {
    const invalid = doc.querySelector<HTMLElement>("[data-error='invalid']")!;
    expect(invalid.dataset.fieldsText).toContain("{fields}");
  });
});

describe("markInvalidFields on the built form", () => {
  it("marks each named field and returns its label, in form order", () => {
    const form = page().querySelector<HTMLFormElement>("form[data-nomination-form]")!;
    const labels = markInvalidFields(form, `?field=${F.contactEmail}&field=${F.website}&error=invalid`);
    expect(labels).toEqual(["Website", "Your email"]);
    expect(form.querySelector(`[name='${F.website}']`)?.getAttribute("aria-invalid")).toBe("true");
    expect(form.querySelector(`[name='${F.legalName}']`)?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("ignores names the form has no labelled control for", () => {
    const form = page().querySelector<HTMLFormElement>("form[data-nomination-form]")!;
    expect(markInvalidFields(form, "?field=website&field=ts&field=%3Cimg%3E")).toEqual([]);
    expect(form.querySelectorAll("[aria-invalid]")).toHaveLength(0);
  });
});

// #318: a nomination that went through no longer needs this tab's draft.
describe("/leaderboard/nominate/thanks/", () => {
  const thanks = () => new DOMParser().parseFromString(readDist("leaderboard/nominate/thanks/index.html"), "text/html");

  it("names the nomination draft to clear", () => {
    const named = [...thanks().querySelectorAll<HTMLElement>("[data-clear-draft]")].map((el) => el.dataset.clearDraft);
    expect(named).toEqual([NOMINATION_DRAFT.key]);
  });

  it("clears that draft, and only that one", () => {
    sessionStorage.setItem(NOMINATION_DRAFT.key, JSON.stringify({ legal_name: "Example Robotics" }));
    sessionStorage.setItem("cs-apply-draft", JSON.stringify({ name: "Test Applicant" }));
    clearNamedDrafts(thanks());
    expect(sessionStorage.getItem(NOMINATION_DRAFT.key)).toBeNull();
    expect(sessionStorage.getItem("cs-apply-draft")).not.toBeNull();
    sessionStorage.clear();
  });
});

// #147: the form asks what a nominator knows, and its labels say who can use it.
describe("/leaderboard/nominate/ asks what a nominator knows", () => {
  const doc = page();
  const form = doc.querySelector<HTMLFormElement>("form[data-nomination-form]")!;
  const field = (name: string) => form.querySelector<HTMLInputElement>(`[name='${name}']`)!;

  it("says who can nominate: the title, the heading and the button", () => {
    expect(doc.title).toMatch(/^Nominate your company/);
    expect(doc.querySelector("h1")?.textContent?.trim()).toBe("Nominate your company");
    expect(form.querySelector("button[type='submit']")?.textContent?.trim()).toBe("Nominate your company");
  });

  it("asks the HQ city first, with the cities whose county it knows as suggestions", () => {
    const city = field(F.hqCity);
    expect(city.hasAttribute("required")).toBe(true);
    expect(city.getAttribute("autocomplete")).toBe("address-level2");
    const options = [...doc.querySelectorAll<HTMLOptionElement>(`#${city.getAttribute("list")} option`)].map((o) => o.value);
    expect(options.sort()).toEqual(Object.keys(PLACE_COUNTIES).sort());
    const county = form.querySelector<HTMLSelectElement>(`select[name='${F.hqCounty}']`)!;
    expect(city.compareDocumentPosition(county) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(county.hasAttribute("required")).toBe(true);
    expect(doc.getElementById(county.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Filled in from the city");
  });

  it("asks the founding year, not a date", () => {
    const year = field(F.foundedYear);
    expect(year.getAttribute("type")).toBe("number");
    expect(year.getAttribute("min")).toBe("1950");
    expect(year.getAttribute("step")).toBe("1");
    expect(form.querySelector("input[type='date']")).toBeNull();
    expect(doc.querySelector(`label[for='${year.id}']`)?.textContent).toBe("Year founded");
  });

  it("fills in the base year as three years before the most recent full year", () => {
    const base = field(F.baseYear);
    expect(Number(base.getAttribute("value"))).toBe(new Date().getUTCFullYear() - 4);
    expect(doc.getElementById(base.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Change it");
  });
});
