// Step P5a: the Slack join request form's parser and notice email, and the
// source-level promises of its two pages (noindex, out of the sitemap, not
// swallowed by the /join redirect, the copy rules). The built pages are
// checked in test/dom/join/join-slack.test.ts. Fixtures use example.org and
// invented names only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BASED_CHOICES,
  DESCRIBES_CHOICES,
  HEARD_CHOICES,
  JOIN_FIELDS as F,
  JOIN_PATH,
  joinNoticeBody,
  joinNoticeSubject,
  joinPathWithInvalidFields,
  parseJoinForm,
} from "../../../src/components/join/fields";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(SITE, rel), "utf8");

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const valid = (over: Record<string, string> = {}) => ({
  first_name: "Testa",
  last_name: "Requester",
  email: "requester@example.org",
  linkedin: "https://www.linkedin.com/in/test-requester",
  based: "colorado",
  city: "Fort Collins",
  describes: "investor-interested",
  heard: "referral",
  newsletter: "on",
  ...over,
});

describe("the Google Form's choices", () => {
  it("offers the three places, eight roles and five sources Paul's form asked for", () => {
    expect(BASED_CHOICES.map(([, l]) => l)).toEqual([
      "Colorado",
      "Outside Colorado, but connected to the Colorado ecosystem",
      "Other",
    ]);
    expect(DESCRIBES_CHOICES).toHaveLength(8);
    expect(DESCRIBES_CHOICES.at(-1)?.[1]).toBe("Other");
    expect(HEARD_CHOICES.map(([, l]) => l)).toEqual(["Word of mouth or referral", "LinkedIn", "Event", "Search", "Other"]);
  });

  it("matches the ids the migration CHECKs", () => {
    const sql = read("migrations/0500_slack_join_requests.sql");
    const inList = (col: string) =>
      [...(sql.match(new RegExp(`${col} IN \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inList("based")).toEqual(BASED_CHOICES.map(([id]) => id));
    expect(inList("describes")).toEqual(DESCRIBES_CHOICES.map(([id]) => id));
    expect(inList("heard")).toEqual(HEARD_CHOICES.map(([id]) => id));
  });
});

describe("parseJoinForm", () => {
  it("accepts a full request and cleans each line", () => {
    const parsed = parseJoinForm(form(valid({ first_name: " Testa\r\nBcc: x@example.org " })));
    expect(parsed).toMatchObject({ ok: true, data: { first_name: "Testa Bcc: x@example.org", newsletter: true } });
  });

  it("treats an unticked newsletter box as no", () => {
    const { newsletter: _drop, ...rest } = valid();
    expect(parseJoinForm(form(rest))).toMatchObject({ ok: true, data: { newsletter: false } });
  });

  it("names the failing fields, never their values", () => {
    const parsed = parseJoinForm(form(valid({ email: "nope", linkedin: "https://example.org/x", city: "" })));
    expect(parsed).toEqual({ ok: false, fields: ["email", "linkedin", "city"] });
  });
});

describe("joinPathWithInvalidFields", () => {
  it("reflects only the form's own field names, in form order", () => {
    expect(joinPathWithInvalidFields(["city", "evil<script>", "email"])).toBe(`${JOIN_PATH}?field=email&field=city`);
    expect(joinPathWithInvalidFields(["form"])).toBe(JOIN_PATH);
  });
});

describe("the notice to Paul", () => {
  it("carries everything he needs to decide and to send the invite", () => {
    const parsed = parseJoinForm(form(valid()));
    if (!parsed.ok) throw new Error("fixture should parse");
    const body = joinNoticeBody(parsed.data, 7);
    expect(joinNoticeSubject(parsed.data)).toBe("Slack join request: Testa Requester");
    for (const want of [
      "Name: Testa Requester",
      "Email (the invite goes here): requester@example.org",
      "LinkedIn: https://www.linkedin.com/in/test-requester",
      "Based: Colorado",
      "City or region: Fort Collins",
      "Describes them: Investor interested in Colorado companies",
      "Heard about us: Word of mouth or referral",
      "Newsletter: yes",
      "Row: slack_join_requests.id = 7",
    ]) {
      expect(body).toContain(want);
    }
  });
});

describe("the /join/slack/ pages in source", () => {
  const page = read("src/pages/join/slack/index.astro");
  const thanks = read("src/pages/join/slack/thanks.astro");
  const formSrc = read("src/components/join/SlackJoinForm.astro");
  const copy = [page, thanks, formSrc].join("\n");

  it("are noindex until P5b", () => {
    for (const src of [page, thanks]) expect(src).toMatch(/<BaseLayout[^>]*\bnoindex\b/s);
  });

  it("stay out of the sitemap", () => {
    // The regex literal from our own config, rebuilt from its source text.
    const body = read("astro.config.mjs").match(/const SITEMAP_EXCLUDE = \/(.+)\/;/)?.[1];
    expect(body).toBeTruthy();
    const exclude = new RegExp(body!);
    expect(exclude.test("https://coloradostartups.org/join/slack/")).toBe(true);
    expect(exclude.test("https://coloradostartups.org/join/slack/thanks/")).toBe(true);
    expect(exclude.test("https://coloradostartups.org/get-involved/apply/")).toBe(false);
  });

  it("are not swallowed by the /join short link, which matches /join and /join/ only", () => {
    const rules = read("public/_redirects")
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[0] ?? "")
      .filter((from) => from.startsWith("/join"));
    expect(rules.sort()).toEqual(["/join", "/join/"]);
  });

  it("follow the copy rules: no member counts, no Outpost, HQ or Hall, no em dashes, one exclamation at most", () => {
    const visible = copy.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(visible).not.toMatch(/\d[\d,]*\+?\s*(members|people|startupers)/i);
    expect(visible).not.toMatch(/18,000/);
    expect(visible).not.toMatch(/\b(Outpost|HQ|Hall)\b/);
    expect(copy).not.toMatch(/—| – /);
    for (const src of [page, thanks]) expect((src.match(/!(?![=-])/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("say a person reviews every request, and keep the 24 hours a goal", () => {
    expect(page).toContain("A person reviews every request before an invite is sent.");
    expect(page).toContain("Our goal is to answer within 24 hours.");
  });

  it("show no keeper", () => {
    expect(copy).not.toMatch(/Keeper|keepers\//);
  });

  it("renders every field name the parser reads", () => {
    for (const name of Object.values(F)) expect(formSrc, name).toContain(`F.${Object.entries(F).find(([, v]) => v === name)![0]}`);
  });
});
