import { describe, expect, it } from "vitest";

import { CONDUCT_GROUPS, CONDUCT_INTRO } from "../../../src/components/info/code-of-conduct";
import {
  CALENDAR_ID,
  calendarEmbedUrl,
  calendarSubscribeUrl,
  CONTACT_EMAIL,
  mailto,
} from "../../../src/components/info/links";
import { formatUpdated, isDraftPolicy, stripHtmlComments } from "../../../src/components/info/privacy";
import { CSP_DIRECTIVES } from "../../../worker/lib/security-headers";

// L13: the pure pieces behind the info pages. The built pages are checked in
// test/dom/l13/.

describe("calendar links", () => {
  it("embeds the community calendar in Denver time", () => {
    const url = new URL(calendarEmbedUrl());
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.pathname).toBe("/calendar/embed");
    expect(url.searchParams.get("src")).toBe(CALENDAR_ID);
    expect(url.searchParams.get("ctz")).toBe("America/Denver");
  });

  it("uses a frame host the enforced CSP allows", () => {
    const frameSrc = CSP_DIRECTIVES.find((d) => d.startsWith("frame-src "))!;
    expect(frameSrc.split(/\s+/)).toContain(new URL(calendarEmbedUrl()).origin);
  });

  it("offers the same calendar to add to Google Calendar", () => {
    const url = new URL(calendarSubscribeUrl());
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("cid")).toBe(CALENDAR_ID);
  });
});

describe("mailto", () => {
  it("addresses the community inbox", () => {
    expect(mailto()).toBe(`mailto:${CONTACT_EMAIL}`);
    expect(CONTACT_EMAIL).toBe("info@coloradostartups.org");
  });

  it("encodes the subject line", () => {
    expect(mailto("Event for the calendar")).toBe(`mailto:${CONTACT_EMAIL}?subject=Event%20for%20the%20calendar`);
  });
});

describe("privacy draft switch", () => {
  it("is a draft until the frontmatter says approved", () => {
    expect(isDraftPolicy("draft")).toBe(true);
    expect(isDraftPolicy("approved")).toBe(false);
  });

  it("treats a missing status as a draft, the safe side", () => {
    expect(isDraftPolicy(undefined)).toBe(true);
  });

  it("strips reviewer comments from the rendered HTML", () => {
    const html = "<!-- DRAFT by L6. PLAN.md -->\n<p>Hello</p><!--x--><p>Bye</p>";
    expect(stripHtmlComments(html)).toBe("<p>Hello</p><p>Bye</p>");
  });

  it("formats the updated date without a time zone shift", () => {
    expect(formatUpdated(new Date("2026-10-08"))).toBe("October 8, 2026");
  });
});

// The replacement rules from the LinkedIn project's W1-page-kit/
// website-changes.md item 9, verbatim. This pins the contract: a wording change
// has to change the lane contract first.
const ITEM_9: Record<string, string> = {
  "Find Talent":
    "Startups hiring in Colorado are welcome to share open roles in each group's designated weekly thread. In the LinkedIn Group, that is the Wednesday Asks and Offers thread.",
  "Create Polls": "Posts with polls for idea validation, market research, and general feedback are encouraged.",
  "Celebrate Wins":
    "Posts about celebrations and major PR stories are encouraged, and so is any press that gives Colorado positive exposure. In the LinkedIn Group, wins go in the Friday Colorado Wins thread.",
  "Promote in One Place":
    "Service providers and product builders matter to this community. Self-promotion goes only in each group's designated weekly thread. That covers your own company, product, service or open job. It also covers Product Hunt launches and rewards crowdfunding (Kickstarter, Indiegogo). In the LinkedIn Group, the thread is Wednesday Asks and Offers.",
  "No Investment Offers":
    "Investment solicitation is never allowed. Don't pitch a fund, SPV, syndicate or open round. Equity crowdfunding (Wefunder, Republic, StartEngine and similar) counts as an investment offer. A closed raise can be shared as a win, with no link to invest.",
  "No Cold Pitches": "Don't use the groups to message members with sales pitches. If it happens to you, tell an admin.",
};

describe("Code of Conduct", () => {
  const rules = CONDUCT_GROUPS.flatMap((g) => g.rules);
  const titles = rules.map((r) => r.title);
  const allText = [CONDUCT_INTRO, ...rules.flatMap((r) => [r.title, ...r.body])].join("\n");

  it("keeps the live page's rules in order, with item 9's replacements", () => {
    expect(titles).toEqual([
      "Engage Initially",
      "Focus on Startups in Colorado",
      "Be Kind and Courteous",
      "Promote Events",
      "Request Help",
      "Offer Help",
      "Find Mentors",
      "Find Talent",
      "Create Polls",
      "Celebrate Wins",
      "Promote in One Place",
      "No Investment Offers",
      "No Cold Pitches",
    ]);
  });

  it.each(Object.entries(ITEM_9))("uses item 9's wording for %s", (title, text) => {
    expect(rules.find((r) => r.title === title)?.body).toEqual([text]);
  });

  it("drops the replaced rules", () => {
    expect(allText).not.toMatch(/Create Pools|SOLICITATIONS|Crowdfunding Campaigns|#talent|#jobs/);
  });

  it("follows the house writing rules", () => {
    expect(allText).not.toMatch(/—|\s–\s/);
    expect(allText.match(/!/g) ?? []).toHaveLength(0);
  });

  it("carries no unsourced member count and no retired links", () => {
    expect(CONDUCT_INTRO).not.toMatch(/\d/);
    expect(allText).not.toMatch(/launchpass|facebook/i);
  });

  it("gives each group a unique anchor", () => {
    const ids = CONDUCT_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
