// L19: the application contract in packages/shared/src/apply.ts, and its
// agreement with data/team/positions.yaml. Fixtures use example.org and
// invented names only; no real person's contact data belongs in a test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApplicationSchema,
  APPLY_LIMITS,
  APPLY_ROLE_IDS,
  CORE_COURSES,
  COURSE_IDS,
  COURSE_TITLES,
  courseUrl,
  LINK_HOSTS,
  parseBadgeLink,
  parseHttpsLink,
  parseLinkedInLink,
  PositionSchema,
  REQUIRED_COURSES,
  withHttps,
} from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const positions = (parse(readFileSync(new URL("../../../../data/team/positions.yaml", import.meta.url), "utf8")) as unknown[]).map(
  (p) => PositionSchema.parse(p),
);

const SITE = new URL("../../../", import.meta.url);
const REPO = new URL("../", SITE);
const badge = (n: number) => `https://academy.claude.com/verify/TEST-000${n}`;

const valid = (over: Record<string, unknown> = {}) => ({
  role: "space-peak-connector",
  name: "Test Applicant",
  email: "applicant@example.org",
  based_in: "Colorado Springs",
  linkedin: null,
  why: "I go to every founder event in town.",
  badges: {
    "claude-101": badge(1),
    "ai-fluency-framework-foundations": badge(2),
    "ai-fluency-for-small-businesses": badge(3),
  },
  anything_else: null,
  consent: true,
  ...over,
});

describe("the seats and their courses", () => {
  it("names the four seats Paul opened for applications", () => {
    expect([...APPLY_ROLE_IDS]).toEqual([
      "slack-community-lead",
      "photon-mountain-connector",
      "fusion-canyon-connector",
      "space-peak-connector",
    ]);
  });

  it("gives every seat Claude 101 and AI Fluency: Framework and foundations", () => {
    expect([...CORE_COURSES]).toEqual(["claude-101", "ai-fluency-framework-foundations"]);
    for (const role of APPLY_ROLE_IDS) expect(REQUIRED_COURSES[role].slice(0, 2)).toEqual([...CORE_COURSES]);
  });

  it("adds Building effective human-agent teams for the Slack seat only", () => {
    expect(REQUIRED_COURSES["slack-community-lead"]).toEqual([...CORE_COURSES, "building-effective-human-agent-teams"]);
  });

  it("adds AI Fluency for small businesses for each Connector seat", () => {
    for (const role of ["photon-mountain-connector", "fusion-canyon-connector", "space-peak-connector"] as const) {
      expect(REQUIRED_COURSES[role]).toEqual([...CORE_COURSES, "ai-fluency-for-small-businesses"]);
    }
  });

  it("titles and links every course on Claude Academy, read there on 2026-10-18", () => {
    expect(COURSE_TITLES).toEqual({
      "claude-101": "Claude 101",
      "ai-fluency-framework-foundations": "AI Fluency: Framework and foundations",
      "building-effective-human-agent-teams": "Building effective human-agent teams",
      "ai-fluency-for-small-businesses": "AI Fluency for small businesses",
    });
    for (const id of COURSE_IDS) expect(courseUrl(id)).toBe(`https://academy.claude.com/courses/${id}`);
  });
});

describe("positions.yaml agrees with REQUIRED_COURSES", () => {
  const applying = positions.filter((p) => p.apply);

  it("gives exactly the four seats an apply block, each open and unpaid in its copy", () => {
    expect(applying.map((p) => p.id).sort()).toEqual([...APPLY_ROLE_IDS].sort());
    for (const p of applying) expect(p.apply?.open, p.id).toBe(true);
  });

  it("lists the same courses, in the same order, as the Worker requires", () => {
    for (const p of applying) {
      expect(p.apply?.courses, p.id).toEqual([...REQUIRED_COURSES[p.id as (typeof APPLY_ROLE_IDS)[number]]]);
    }
  });

  it("titles the seats as Paul named them", () => {
    const titles = Object.fromEntries(applying.map((p) => [p.id, p.title]));
    expect(titles).toEqual({
      "slack-community-lead": "Slack Community Lead",
      "photon-mountain-connector": "Photon Mountain Connector",
      "fusion-canyon-connector": "Fusion Canyon Connector",
      "space-peak-connector": "Space Peak Connector",
    });
  });

  it("refuses a course id that is not a Claude Academy course in COURSE_IDS", () => {
    const seat = { ...applying[0], apply: { open: true, courses: ["claude-202"] } };
    expect(PositionSchema.safeParse(seat).success).toBe(false);
  });

  // Old ids appear in tests only to prove they are rejected or not
  // preselected (orchestrator's L19 review, item 8). Nowhere else.
  const OLD_IDS = ["slack-moderator", "organizer-photon-mountain", "organizer-space-peak", "organizer-fusion-canyon"];

  it("keeps the old seat ids out of the data", () => {
    const ids = positions.map((p) => p.id);
    for (const old of OLD_IDS) expect(ids).not.toContain(old);
  });

  it("keeps the old seat ids out of every source, data and runbook file", () => {
    const roots = ["site/src", "site/worker", "packages/shared/src", "data", "ops/runbooks", "site/migrations"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    for (const root of roots) walk(fileURLToPath(new URL(root, REPO)));
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const old of OLD_IDS) expect(text.includes(old), `${old} in ${file}`).toBe(false);
    }
  });

  // Decision 45's regions, beside which the region pages show these cards.
  it("covers each Connector's whole region: every city, or Paul's anchor cities and the rest of the region", () => {
    const regionsDir = new URL("data/regions/", REPO);
    for (const p of applying.filter((x) => x.area === "region")) {
      const region = parse(readFileSync(new URL(`${p.region}.yaml`, regionsDir), "utf8")) as { name: string; cities: string[] };
      const everyCity = region.cities.every((c) => p.summary.includes(c));
      const anchorsAndRest = p.summary.includes(`and the rest of ${region.name}`);
      expect(everyCity || anchorsAndRest, `${p.id}: ${p.summary}`).toBe(true);
    }
  });
});

describe("parseHttpsLink", () => {
  it("keeps an https link, normalized by URL()", () => {
    expect(parseHttpsLink("  https://Verify.Example.org/badge?id=7  ")).toBe("https://verify.example.org/badge?id=7");
  });

  // #138: people paste a LinkedIn link from the app or type it bare.
  it("adds https:// to a link typed without a scheme", () => {
    expect(parseHttpsLink("linkedin.com/in/someone")).toBe("https://linkedin.com/in/someone");
    expect(parseHttpsLink(" www.linkedin.com/in/someone ")).toBe("https://www.linkedin.com/in/someone");
  });

  it.each([
    ["an http link", "http://verify.example.org/badge"],
    ["a javascript: link", "javascript:alert(1)"],
    ["a data: link", "data:text/html,hi"],
    ["a bare host with no dot", "localhost/badge"],
    ["a link with a password", "https://user:pw@verify.example.org/"],
    ["a host with no dot", "https://localhost/badge"],
    ["a host ending in a dot", "https://example.org./badge"],
    ["a link with a space", "https://verify.example.org/a b"],
    ["an over-long link", `https://verify.example.org/${"a".repeat(APPLY_LIMITS.link)}`],
    ["an empty value", ""],
    ["a link with a port", "https://verify.example.org:8443/badge"],
  ])("refuses %s", (_label, value) => {
    expect(parseHttpsLink(value)).toBeNull();
  });
});

describe("LINK_HOSTS: where an applicant's links may point", () => {
  it("allows Claude Academy for badges and LinkedIn for profiles, nothing else", () => {
    expect(LINK_HOSTS).toEqual({ badge: ["academy.claude.com"], linkedin: ["linkedin.com"] });
  });

  it.each(["https://academy.claude.com/verify/ABC123", "https://academy.claude.com/badges/42", "https://ACADEMY.claude.com/verify/x"])(
    "accepts the badge link %s",
    (value) => {
      expect(parseBadgeLink(value)).toBe(new URL(value).href);
    },
  );

  it.each([
    ["a lookalike suffix", "https://academy.claude.com.evil.example/verify/1"],
    ["a subdomain of the host", "https://evil.academy.claude.com/verify/1"],
    ["a sibling host", "https://claude.com/verify/1"],
    ["a near-miss domain", "https://academy.claude.co/verify/1"],
    ["a hyphenated lookalike", "https://academy-claude.com/verify/1"],
    ["a punycode lookalike", "https://xn--academy-claude-xyz.com/verify/1"],
    ["http", "http://academy.claude.com/verify/1"],
    ["a port", "https://academy.claude.com:8443/verify/1"],
    ["no path", "https://academy.claude.com/"],
    ["a Skilljar certificate", "https://verify.skilljar.com/c/abc123"],
  ])("refuses a badge link with %s", (_label, value) => {
    expect(parseBadgeLink(value)).toBeNull();
  });

  it.each(["https://www.linkedin.com/in/test-applicant", "https://linkedin.com/in/test-applicant", "https://in.linkedin.com/in/test"])(
    "accepts the LinkedIn link %s",
    (value) => {
      expect(parseLinkedInLink(value)).toBe(value);
    },
  );

  it.each([
    ["a lookalike suffix", "https://linkedin.com.evil.example/in/x"],
    ["a lookalike prefix", "https://evillinkedin.com/in/x"],
    ["a short-link host", "https://lnkd.in/abc"],
    ["http", "http://www.linkedin.com/in/x"],
    ["no path", "https://www.linkedin.com/"],
    ["a port", "https://www.linkedin.com:444/in/x"],
  ])("refuses a LinkedIn link with %s", (_label, value) => {
    expect(parseLinkedInLink(value)).toBeNull();
  });
});

describe("0400_applications.sql agrees with the contract", () => {
  const sql = readFileSync(new URL("migrations/0400_applications.sql", SITE), "utf8");

  it("checks role against exactly APPLY_ROLE_IDS", () => {
    const list = sql.match(/CHECK \(role IN \(([^)]+)\)\)/)?.[1] ?? "";
    expect(list.split(",").map((v) => v.trim().replace(/'/g, ""))).toEqual([...APPLY_ROLE_IDS]);
  });

  it("checks badges is JSON and that a decided row keeps no applicant field", () => {
    expect(sql).toContain("CHECK (badges IS NULL OR json_valid(badges))");
    const decided = sql.slice(sql.indexOf("status IN ('new', 'reviewing')"));
    for (const col of ["name", "email", "based_in", "linkedin", "why", "badges", "anything_else"]) {
      expect(decided, col).toContain(`${col} IS NULL`);
    }
  });
});

describe("ApplicationSchema", () => {
  it("accepts a complete application", () => {
    expect(ApplicationSchema.safeParse(valid()).success).toBe(true);
  });

  it("accepts an https LinkedIn link and an answer to anything else", () => {
    const got = ApplicationSchema.safeParse(
      valid({ linkedin: "https://www.linkedin.com/in/test-applicant", anything_else: "Weekends work best." }),
    );
    expect(got.success).toBe(true);
  });

  it.each([
    // An old seat id, kept here to prove it is rejected (review item 8).
    ["an unknown seat", { role: "slack-moderator" }],
    ["a missing name", { name: "" }],
    ["a bad email", { email: "not-an-email" }],
    ["a missing city", { based_in: "" }],
    ["an http LinkedIn link", { linkedin: "http://www.linkedin.com/in/test-applicant" }],
    ["a LinkedIn link on another host", { linkedin: "https://linkedin.com.evil.example/in/test-applicant" }],
    ["a missing why", { why: "" }],
    ["a why over the cap", { why: "x".repeat(APPLY_LIMITS.why + 1) }],
    ["anything else over the cap", { anything_else: "x".repeat(APPLY_LIMITS.anythingElse + 1) }],
    ["no consent", { consent: false }],
  ])("refuses %s", (_label, over) => {
    expect(ApplicationSchema.safeParse(valid(over)).success).toBe(false);
  });

  it("requires exactly the chosen seat's courses", () => {
    const { "ai-fluency-for-small-businesses": _dropped, ...missingOne } = valid().badges;
    expect(ApplicationSchema.safeParse(valid({ badges: missingOne })).success).toBe(false);

    const extra = { ...valid().badges, "building-effective-human-agent-teams": badge(4) };
    expect(ApplicationSchema.safeParse(valid({ badges: extra })).success).toBe(false);

    // The Slack seat needs the human-agent teams course, not the small-business one.
    expect(ApplicationSchema.safeParse(valid({ role: "slack-community-lead" })).success).toBe(false);
  });

  it("refuses a badge link that is not https, or not on academy.claude.com", () => {
    for (const link of ["http://academy.claude.com/verify/1", "https://verify.example.org/badges/1"]) {
      const badges = { ...valid().badges, "claude-101": link };
      expect(ApplicationSchema.safeParse(valid({ badges })).success, link).toBe(false);
    }
  });
});

describe("withHttps", () => {
  it("adds https:// only when the value has no scheme", () => {
    expect(withHttps("acme.com")).toBe("https://acme.com");
    expect(withHttps(" acme.com/a ")).toBe("https://acme.com/a");
    for (const kept of ["", "https://acme.com", "http://acme.com", "javascript:alert(1)", "mailto:a@acme.com"]) {
      expect(withHttps(kept), kept).toBe(kept);
    }
  });
});
