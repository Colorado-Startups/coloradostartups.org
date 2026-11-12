// L19: the form parser the Worker uses, the ?role= preselect, the per-seat
// course fields, the notice to Paul, and the never-fetch rule (BRIEF hard
// constraint 12). Fixtures use example.org and invented names only.
import { readFileSync } from "node:fs";

import { REQUIRED_COURSES } from "@cs/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { courseShownFor, draftFrom, parseDraft, roleFromSearch } from "../../../src/components/apply/client";
import { NOMINATION_DRAFT } from "../../../src/lib/leaderboard/nomination";
import {
  APPLY_FIELDS as F,
  applyPathFor,
  BADGE_PATTERN,
  badgeField,
  cleanLine,
  cleanLongText,
  LINKEDIN_PATTERN,
  noticeBody,
  noticeSubject,
  parseApplicationForm,
} from "../../../src/components/apply/fields";

const ROLES = ["slack-community-lead", "photon-mountain-connector", "fusion-canyon-connector", "space-peak-connector"];

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (over: Record<string, string> = {}) => ({
  [F.role]: "photon-mountain-connector",
  [F.name]: "Test Applicant",
  [F.email]: "applicant@example.org",
  [F.basedIn]: "Golden",
  [F.linkedin]: "",
  [F.why]: "I already host a founder breakfast in Golden.",
  [badgeField("claude-101")]: "https://academy.claude.com/verify/TEST-0001",
  [badgeField("ai-fluency-framework-foundations")]: "https://academy.claude.com/verify/TEST-0002",
  [badgeField("ai-fluency-for-small-businesses")]: "https://academy.claude.com/verify/TEST-0003",
  [F.anythingElse]: "",
  [F.consent]: "on",
  ...over,
});

describe("roleFromSearch: the ?role= preselect", () => {
  it.each(ROLES)("preselects %s", (role) => {
    expect(roleFromSearch(`?role=${role}`, ROLES)).toBe(role);
  });

  it("ignores a missing, empty or unknown seat", () => {
    expect(roleFromSearch("", ROLES)).toBeNull();
    expect(roleFromSearch("?role=", ROLES)).toBeNull();
    // An old seat id, kept to prove an old link preselects nothing (review item 8).
    expect(roleFromSearch("?role=slack-moderator", ROLES)).toBeNull();
    expect(roleFromSearch("?role=%3Cscript%3E", ROLES)).toBeNull();
  });

  it("takes the first known value when the parameter repeats, and keeps other parameters apart", () => {
    expect(roleFromSearch("?role=nope&role=space-peak-connector", ROLES)).toBe("space-peak-connector");
    expect(roleFromSearch("?error=invalid&role=fusion-canyon-connector", ROLES)).toBe("fusion-canyon-connector");
  });

  it("only preselects a seat the page lists", () => {
    expect(roleFromSearch("?role=space-peak-connector", ["slack-community-lead"])).toBeNull();
  });
});

describe("courseShownFor: each seat shows only its courses", () => {
  it("shows a course tagged with the chosen seat, and hides the rest", () => {
    expect(courseShownFor("slack-community-lead", "slack-community-lead")).toBe(true);
    expect(courseShownFor("space-peak-connector", "photon-mountain-connector fusion-canyon-connector space-peak-connector")).toBe(true);
    expect(courseShownFor("slack-community-lead", "photon-mountain-connector space-peak-connector")).toBe(false);
  });

  it("shows no course before a seat is chosen", () => {
    expect(courseShownFor(null, ROLES.join(" "))).toBe(false);
  });

  it("matches whole seat ids, not parts of them", () => {
    expect(courseShownFor("space-peak", "space-peak-connector")).toBe(false);
  });
});

describe("applyPathFor: where an error sends the applicant", () => {
  it("keeps a known seat selected, trimmed the way the parser trims it", () => {
    expect(applyPathFor("fusion-canyon-connector")).toBe("/get-involved/apply/?role=fusion-canyon-connector");
    expect(applyPathFor(" fusion-canyon-connector ")).toBe("/get-involved/apply/?role=fusion-canyon-connector");
  });

  it("reflects nothing else", () => {
    expect(applyPathFor("https://evil.example/")).toBe("/get-involved/apply/");
    expect(applyPathFor(null)).toBe("/get-involved/apply/");
  });
});

describe("parseApplicationForm", () => {
  it("returns the application with the seat's badges keyed by course", () => {
    const got = parseApplicationForm(form(valid()));
    expect(got).toEqual({
      ok: true,
      data: {
        role: "photon-mountain-connector",
        name: "Test Applicant",
        email: "applicant@example.org",
        based_in: "Golden",
        linkedin: null,
        why: "I already host a founder breakfast in Golden.",
        badges: {
          "claude-101": "https://academy.claude.com/verify/TEST-0001",
          "ai-fluency-framework-foundations": "https://academy.claude.com/verify/TEST-0002",
          "ai-fluency-for-small-businesses": "https://academy.claude.com/verify/TEST-0003",
        },
        anything_else: null,
        consent: true,
      },
    });
  });

  it("reads only the chosen seat's badge fields and ignores another seat's", () => {
    const got = parseApplicationForm(
      form(valid({ [badgeField("building-effective-human-agent-teams")]: "https://academy.claude.com/verify/TEST-0009" })),
    );
    expect(got.ok && Object.keys(got.data.badges)).toEqual([...REQUIRED_COURSES["photon-mountain-connector"]]);
  });

  it("needs every course the seat requires", () => {
    for (const course of REQUIRED_COURSES["photon-mountain-connector"]) {
      const got = parseApplicationForm(form(valid({ [badgeField(course)]: "" })));
      expect(got, course).toEqual({ ok: false, fields: ["badges"] });
    }
  });

  it("asks the Slack seat for the human-agent teams course", () => {
    const slack = valid({ [F.role]: "slack-community-lead" });
    expect(parseApplicationForm(form(slack)).ok).toBe(false);
    const withCourse = { ...slack, [badgeField("building-effective-human-agent-teams")]: "https://academy.claude.com/verify/TEST-0004" };
    const got = parseApplicationForm(form(withCourse));
    expect(got.ok && Object.keys(got.data.badges)).toEqual([...REQUIRED_COURSES["slack-community-lead"]]);
  });

  it.each([
    // An old seat id, kept to prove it is rejected (review item 8). Zod skips
    // the badge refinement once the seat itself fails.
    ["an unknown seat", { [F.role]: "slack-moderator" }, ["role"]],
    ["an http badge link", { [badgeField("claude-101")]: "http://academy.claude.com/verify/TEST-0001" }, ["badges"]],
    ["a badge link on another host", { [badgeField("claude-101")]: "https://verify.example.org/badges/1" }, ["badges"]],
    ["a LinkedIn link on another host", { [F.linkedin]: "https://linkedin.com.evil.example/in/test" }, ["linkedin"]],
    ["a javascript: LinkedIn link", { [F.linkedin]: "javascript:alert(1)" }, ["linkedin"]],
    ["an http LinkedIn link", { [F.linkedin]: "http://www.linkedin.com/in/test" }, ["linkedin"]],
    ["no consent", { [F.consent]: "" }, ["consent"]],
    ["a blank why", { [F.why]: "   " }, ["why"]],
  ])("refuses %s and names the field, never its value", (_label, over, fields) => {
    const got = parseApplicationForm(form(valid(over)));
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.fields.sort()).toEqual([...fields].sort());
      expect(JSON.stringify(got)).not.toContain("applicant@example.org");
    }
  });

  it("strips ESC, C1 controls, zero-width and bidi characters from names, places and answers", () => {
    const got = parseApplicationForm(
      form(
        valid({
          [F.name]: "Te\u001bst\u009b \u202eApplicant\u200b",
          [F.basedIn]: "\u2066Golden\u2069\u00ad",
          [F.why]: "Line one\u202e\tend\u001b\nLine two\u0085",
          [F.anythingElse]: "Note\ufeff",
        }),
      ),
    );
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.data.name).toBe("Test Applicant");
    expect(got.data.based_in).toBe("Golden");
    expect(got.data.why).toBe("Line oneend\nLine two");
    expect(got.data.anything_else).toBe("Note");
  });

  it("keeps letters, accents and emoji, and the line breaks in long answers", () => {
    expect(cleanLine("José Núñez 🚀")).toBe("José Núñez 🚀");
    expect(cleanLongText("Uno\r\nDos\rTres")).toBe("Uno\nDos\nTres");
  });

  it("strips line breaks from one-line fields and control characters from answers", () => {
    const got = parseApplicationForm(
      form(valid({ [F.name]: "Test\r\nBcc: x@example.org", [F.why]: "One\u0007 line\r\nTwo" })),
    );
    expect(got.ok && got.data.name).toBe("Test Bcc: x@example.org");
    expect(got.ok && got.data.why).toBe("One line\nTwo");
  });
});

describe("the browser patterns match the Worker's host rules", () => {
  // Browsers anchor a pattern attribute and compile it with the v flag.
  const browser = (pattern: string) => new RegExp(`^(?:${pattern})$`, "v");

  it("BADGE_PATTERN takes academy.claude.com links only", () => {
    const re = browser(BADGE_PATTERN);
    expect(re.test("https://academy.claude.com/verify/TEST-0001")).toBe(true);
    for (const bad of [
      "http://academy.claude.com/verify/1",
      "https://academy.claude.com.evil.example/verify/1",
      "https://evil.academy.claude.com/verify/1",
      "https://academy.claude.com/",
      "https://academyXclaude.com/verify/1",
    ]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });

  it("LINKEDIN_PATTERN takes linkedin.com and its subdomains only", () => {
    const re = browser(LINKEDIN_PATTERN);
    for (const good of [
      "https://www.linkedin.com/in/x",
      "https://linkedin.com/in/x",
      "https://in.linkedin.com/in/x",
      // #138: typed without the scheme.
      "linkedin.com/in/x",
      "www.linkedin.com/in/x",
    ]) {
      expect(re.test(good), good).toBe(true);
    }
    for (const bad of [
      "https://linkedin.com.evil.example/in/x",
      "https://evillinkedin.com/in/x",
      "http://www.linkedin.com/in/x",
      "linkedin.com.evil.example/in/x",
      "linkedin.com",
    ]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });
});

describe("the sessionStorage draft", () => {
  it("keeps the applicant's text fields and drops the honeypot, stamp, token, consent and empty fields", () => {
    const draft = draftFrom(
      form({ ...valid(), website: "spam", ts: "123", "cf-turnstile-response": "token", [F.anythingElse]: "" }).entries(),
    );
    expect(draft).toMatchObject({ [F.role]: "photon-mountain-connector", [F.name]: "Test Applicant" });
    for (const name of ["website", "ts", "cf-turnstile-response", F.consent, F.anythingElse]) {
      expect(draft, name).not.toHaveProperty(name);
    }
  });

  it("keeps a nomination's text answers and drops its boxes, revenue and headcount", () => {
    const draft = draftFrom(
      form({
        legal_name: "Example Robotics",
        company_website: "example.com",
        base_year: "2022",
        base_year_revenue_usd: "1,200,000",
        current_year_revenue_usd: "4,800,000",
        fte_headcount: "32",
        consent_to_publish: "on",
        attestation: "on",
        private_independent_for_profit: "on",
        return_to: "/leaderboard/nominate/",
        website: "spam",
      }).entries(),
      NOMINATION_DRAFT,
    );
    expect(draft).toEqual({ legal_name: "Example Robotics", company_website: "example.com", base_year: "2022" });
    expect(parseDraft(JSON.stringify({ legal_name: "X", fte_headcount: "9" }), NOMINATION_DRAFT)).toEqual({ legal_name: "X" });
  });

  it("reads back only a flat object of strings, and never a skipped field", () => {
    expect(parseDraft(JSON.stringify({ name: "Test Applicant", consent: "on", n: 3 }))).toEqual({ name: "Test Applicant" });
    for (const bad of [null, "", "not json", "[1,2]", "null", "42"]) expect(parseDraft(bad), String(bad)).toBeNull();
  });
});

describe("a LinkedIn link typed without https:// (#138)", () => {
  it("is stored with https:// in front", () => {
    const got = parseApplicationForm(form(valid({ [F.linkedin]: "linkedin.com/in/test-applicant" })));
    expect(got.ok && got.data.linkedin).toBe("https://linkedin.com/in/test-applicant");
  });

  it("is still refused when it points off linkedin.com", () => {
    const got = parseApplicationForm(form(valid({ [F.linkedin]: "evil.example/in/test-applicant" })));
    expect(got.ok).toBe(false);
    expect(!got.ok && got.fields).toEqual(["linkedin"]);
  });
});

describe("the notice to Paul", () => {
  it("carries the seat and the row id, and no contact data or answers", () => {
    const parsed = parseApplicationForm(form(valid({ [F.linkedin]: "https://www.linkedin.com/in/test-applicant" })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const all = `${noticeSubject(parsed.data.role)}\n${noticeBody(parsed.data.role, 7)}`;
    expect(all).toContain("photon-mountain-connector");
    expect(all).toContain("applications.id = 7");
    for (const value of [
      parsed.data.name,
      parsed.data.email,
      parsed.data.based_in,
      parsed.data.why,
      parsed.data.linkedin!,
      ...Object.values(parsed.data.badges),
    ]) {
      expect(all).not.toContain(value);
    }
  });
});

describe("the never-fetch rule (BRIEF hard constraint 12)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses every link without touching the network", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("the application parser must never fetch");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const got = parseApplicationForm(form(valid({ [F.linkedin]: "https://www.linkedin.com/in/test-applicant" })));
    expect(got.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // A source check backs up the behavior test: the route and its parser make
  // no network call of their own. Turnstile's siteverify is the one outbound
  // call, and it lives in worker/lib/turnstile.ts.
  it.each(["worker/routes/apply.ts", "src/components/apply/fields.ts", "src/components/apply/client.ts"])(
    "%s calls no fetch and opens no socket",
    (file) => {
      const source = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
      const code = source
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toMatch(/\bfetch\s*\(|\bconnect\s*\(|new\s+WebSocket\b|XMLHttpRequest|\.fetch\s*\(/);
    },
  );
});
