// The URL helpers in scripts/canvas/lib/url.mjs. Pure functions, no network.
import { describe, expect, it } from "vitest";

import {
  cleanUrl,
  dedupeKey,
  isAggregatorProfile,
  isPersonProfile,
  isReferralUrl,
  siteOf,
  unwrapGoogleRedirect,
} from "../../../../scripts/canvas/lib/url.mjs";

const wrap = (target: string) =>
  `https://www.google.com/url?q=${target}&sa=D&source=editors&ust=1791493285176789&usg=AOvVaw0npSUp`;

describe("isReferralUrl", () => {
  it("catches referral, invite and affiliate links", () => {
    expect(isReferralUrl("https://onboarding.novo.co/signup?referral_code=SomeoneNamed1")).toBe(true);
    expect(isReferralUrl("http://brex.com/signup?rc=9YLnEwX&src=c")).toBe(true);
    expect(isReferralUrl("https://example.org/?ref=abc")).toBe(true);
    expect(isReferralUrl("https://example.org/?invite=x")).toBe(true);
    expect(isReferralUrl("https://example.org/signup?code=x")).toBe(true);
    expect(isReferralUrl("https://example.org/invite/abc123")).toBe(true);
  });

  it("leaves ordinary links alone", () => {
    expect(isReferralUrl("https://www.novo.co/")).toBe(false);
    expect(isReferralUrl("https://example.org/signup")).toBe(false);
    expect(isReferralUrl("https://example.org/events?city=denver")).toBe(false);
  });
});

describe("url helpers", () => {
  it("unwraps the Google redirect and drops its per-export parameters", () => {
    expect(unwrapGoogleRedirect(wrap("https://www.1millioncups.com/"))).toBe("https://www.1millioncups.com/");
    expect(cleanUrl(wrap("https://www.1millioncups.com/"))).toBe("https://www.1millioncups.com/");
  });

  it("unwraps a doubly wrapped link whose inner query is percent-encoded", () => {
    const inner = "https://www.google.com/url?q%3Dhttps://tedxboulder.com/%26sa%3DD%26ust%3D1";
    expect(cleanUrl(wrap(inner))).toBe("https://tedxboulder.com/");
  });

  it("removes tracking parameters, fragments and a trailing ampersand", () => {
    expect(cleanUrl("https://example.org/a?utm_source=x&id=7#top")).toBe("https://example.org/a?id=7");
    expect(cleanUrl("https://www.meetup.com/Access-Silicon-Valley/&")).toBe("https://www.meetup.com/Access-Silicon-Valley/");
  });

  it("refuses anything that is not http or https", () => {
    expect(cleanUrl("mailto:hello@example.org")).toBeNull();
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
  });

  it("treats scheme, www and a trailing slash as the same page", () => {
    expect(dedupeKey("http://www.example.org/x/")).toBe(dedupeKey("https://example.org/x"));
    expect(dedupeKey("https://example.org/x")).not.toBe(dedupeKey("https://example.org/y"));
    expect(siteOf("https://sub.example.org/a")).toBe("example.org");
  });

  it("knows a person's profile and a Crunchbase page", () => {
    expect(isPersonProfile("https://www.linkedin.com/in/someone/")).toBe(true);
    expect(isPersonProfile("https://angel.co/p/someone")).toBe(true);
    expect(isPersonProfile("https://www.linkedin.com/company/acme/")).toBe(false);
    expect(isAggregatorProfile("https://www.crunchbase.com/organization/acme")).toBe(true);
    expect(isAggregatorProfile("https://acme.example/")).toBe(false);
  });
});
