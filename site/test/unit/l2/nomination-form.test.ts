// The nomination form's browser patterns, the bare-address fix (#138), and the
// field list a rejection sends back (#132). Fixtures use example.com only.
import { describe, expect, it } from "vitest";

import {
  NOMINATE_PATH,
  NOMINATION_FIELDS as F,
  parseNominationForm,
  parseUsd,
  pathWithInvalidFields,
  USD_PATTERN,
  WEBSITE_PATTERN,
} from "../../../src/lib/leaderboard/nomination";
import { FORM_ROUTES } from "../../live/smoke-lib.mjs";

// Browsers anchor a pattern attribute and compile it with the v flag.
const browser = (pattern: string) => new RegExp(`^(?:${pattern})$`, "v");

const valid = (over: Record<string, string> = {}): FormData => {
  const f = new FormData();
  const fields: Record<string, string> = {
    [F.legalName]: "Example Robotics, Inc.",
    [F.website]: "https://example.com",
    [F.hqCity]: "Boulder",
    [F.hqCounty]: "Boulder",
    [F.foundedYear]: "2019",
    [F.privateIndependentForProfit]: "on",
    [F.baseYear]: "2022",
    [F.baseYearRevenue]: "1,200,000",
    [F.currentYearRevenue]: "4800000",
    [F.fteHeadcount]: "32",
    [F.sector]: "Hardware and robotics",
    [F.contactName]: "Sam Founder",
    [F.contactEmail]: "sam@example.com",
    [F.consentToPublish]: "on",
    [F.attestation]: "on",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describe("WEBSITE_PATTERN", () => {
  const re = browser(WEBSITE_PATTERN);

  it("takes an address with or without http(s)://", () => {
    for (const good of ["example.com", "www.example.co.uk/about", "https://example.com", "http://example.com/x?y=1"]) {
      expect(re.test(good), good).toBe(true);
    }
  });

  it("refuses what the parser would refuse", () => {
    for (const bad of ["example", "javascript:alert.x", "ftp://example.com", "https:example.com", "a b.com", ""]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });

  it("lets through ordinary addresses the parser accepts", () => {
    for (const typed of ["example.com", "www.example.co.uk/about", "http://example.com/x?y=1"]) {
      expect(re.test(typed)).toBe(true);
      expect(parseNominationForm(valid({ [F.website]: typed })).ok, typed).toBe(true);
    }
  });
});

// #318: the pattern checks the shape, not which characters a host may hold.
// What it lets through and URL() refuses still fails on the Worker, which
// names the field.
describe("WEBSITE_PATTERN is a shape check", () => {
  const re = browser(WEBSITE_PATTERN);

  it.each(["%.com", "a<b.com", "[.com"])("lets %s through, and the parser names company_website", (typed) => {
    expect(re.test(typed)).toBe(true);
    const got = parseNominationForm(valid({ [F.website]: typed }));
    expect(got.ok).toBe(false);
    expect(!got.ok && got.fields).toEqual(["website"]);
    expect(pathWithInvalidFields(NOMINATE_PATH, got.ok ? [] : got.fields)).toBe(`${NOMINATE_PATH}?field=company_website`);
  });
});

describe("USD_PATTERN", () => {
  const re = browser(USD_PATTERN);

  it("takes whole dollars, cents, commas and a leading $", () => {
    for (const good of ["1200000", "1,200,000", "$1,200,000", "$ 1,200.50", " 42 "]) {
      expect(re.test(good), good).toBe(true);
      expect(Number.isNaN(parseUsd(good)), good).toBe(false);
    }
  });

  it("refuses the formats parseUsd refuses, 1.2M among them", () => {
    for (const bad of ["1.2M", "-5", "1e6", "two million", "1.234", "$", ""]) {
      expect(re.test(bad), bad).toBe(false);
      expect(Number.isNaN(parseUsd(bad)), bad).toBe(true);
    }
  });
});

describe("a website typed without https:// (#138)", () => {
  it("is stored with https:// in front", () => {
    const got = parseNominationForm(valid({ [F.website]: "example.com" }));
    expect(got.ok && got.data.website).toBe("https://example.com");
  });

  it("keeps an http:// address as typed", () => {
    const got = parseNominationForm(valid({ [F.website]: "http://example.com" }));
    expect(got.ok && got.data.website).toBe("http://example.com");
  });
});

// #147: the form asks what a nominator knows. A year, not a date, and the city
// beside the county.
describe("founding year and HQ city (#147)", () => {
  it("stores the year as a number and the city as typed", () => {
    const got = parseNominationForm(valid({ [F.hqCity]: "  Fort Collins ", [F.hqCounty]: "Larimer" }));
    expect(got.ok).toBe(true);
    expect(got.ok && got.data).toMatchObject({ founded_year: 2019, hq_city: "Fort Collins", hq_county: "Larimer" });
    expect(got.ok && "founded" in got.data).toBe(false);
  });

  it.each([
    ["a full date", "2019-04-01"],
    ["words", "spring 2019"],
    ["a year before 1950", "1949"],
    ["an empty answer", ""],
  ])("refuses %s as the founding year and names founded_year", (_, typed) => {
    const got = parseNominationForm(valid({ [F.foundedYear]: typed }));
    expect(!got.ok && got.fields).toEqual(["founded_year"]);
  });

  it("refuses a founding year after this one", () => {
    const next = String(new Date().getUTCFullYear() + 1);
    const got = parseNominationForm(valid({ [F.foundedYear]: next }));
    expect(!got.ok && got.fields).toEqual(["founded_year"]);
  });

  it("requires the city", () => {
    const got = parseNominationForm(valid({ [F.hqCity]: " " }));
    expect(!got.ok && got.fields).toEqual(["hq_city"]);
  });
});

describe("the live smoke run's nomination", () => {
  // A payload the parser refused would stop before Turnstile, so the smoke
  // run could never check that the route refuses a bad token.
  it("passes the parser, so the route reaches Turnstile", () => {
    const route = FORM_ROUTES.find((r) => r.path === "/api/nominate")!;
    const form = new FormData();
    for (const [k, v] of Object.entries(route.fields(Date.now()))) form.set(k, String(v));
    expect(parseNominationForm(form)).toMatchObject({ ok: true });
  });
});

describe("pathWithInvalidFields (#132)", () => {
  it("names each field to fix by its form name, in form order", () => {
    expect(pathWithInvalidFields(NOMINATE_PATH, ["contact_email", "website", "base_year_revenue_usd"])).toBe(
      `${NOMINATE_PATH}?field=company_website&field=base_year_revenue_usd&field=contact_email`,
    );
  });

  it("drops anything that is not a form field, and repeats nothing", () => {
    expect(pathWithInvalidFields(NOMINATE_PATH, ["form", "<script>", "sector", "sector"])).toBe(
      `${NOMINATE_PATH}?field=sector`,
    );
    expect(pathWithInvalidFields(NOMINATE_PATH, [])).toBe(NOMINATE_PATH);
  });

  it("covers every field the parser can report", () => {
    const blank = new FormData();
    const got = parseNominationForm(blank);
    expect(got.ok).toBe(false);
    const named = new URLSearchParams(pathWithInvalidFields(NOMINATE_PATH, got.ok ? [] : got.fields).split("?")[1]);
    expect(named.getAll("field").sort()).toEqual(Object.values(F).sort());
  });
});
