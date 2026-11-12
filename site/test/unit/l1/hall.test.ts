import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { CHANNELS } from "../../../src/components/hall/channels";
import {
  ADDRESS,
  GITHUB_ORG,
  homeJsonLd,
  organizationJsonLd,
  organizationRef,
  TAGLINE,
  websiteJsonLd,
} from "../../../src/components/hall/org";
import { WAYS } from "../../../src/components/hall/ways";

// L1: the pure pieces behind the Hall front pages. The built-page checks live
// in test/dom/l1/.

const SITE = new URL("https://coloradostartups.org");

describe("organizationJsonLd", () => {
  const org = organizationJsonLd(SITE);

  it("is a schema.org Organization named Colorado Startups, with the stable @id", () => {
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toBe("https://coloradostartups.org/#organization");
    expect(org.name).toBe("Colorado Startups");
    expect(org.url).toBe("https://coloradostartups.org/");
    expect(org.description).toBe(TAGLINE);
  });

  it("names Paul as founder with the @id of his Person node on /team/", () => {
    expect(org.founder).toEqual({
      "@type": "Person",
      "@id": "https://coloradostartups.org/team/#paul-foley",
      name: "Paul Foley",
    });
  });

  it("gives an absolute logo URL on the same origin", () => {
    expect(org.logo).toBe("https://coloradostartups.org/brand/cs-logo-1500.png");
  });

  it("gives a PostalAddress with every field", () => {
    expect(org.address).toEqual({ "@type": "PostalAddress", ...ADDRESS });
    for (const value of Object.values(ADDRESS)) expect(value).not.toBe("");
  });

  it("lists the LinkedIn Page, the LinkedIn Group and the GitHub organization in sameAs", () => {
    expect(org.sameAs).toEqual([WAYS_IN["linkedin-page"], WAYS_IN["linkedin-group"], GITHUB_ORG]);
    expect(GITHUB_ORG).toBe("https://github.com/Colorado-Startups");
  });

  it("keeps on-site pages out of sameAs: sameAs names profiles elsewhere", () => {
    for (const url of org.sameAs as string[]) expect(new URL(url).origin, url).not.toBe(SITE.origin);
  });

  it("builds every URL from the origin it is given, so staging describes itself", () => {
    const origin = "https://staging.example.workers.dev";
    const staging = organizationJsonLd(new URL(origin));
    expect(staging["@id"]).toBe(`${origin}/#organization`);
    expect(staging.url).toBe(`${origin}/`);
    expect(staging.logo).toBe(`${origin}/brand/cs-logo-1500.png`);
    expect((staging.founder as Record<string, string>)["@id"]).toBe(`${origin}/team/#paul-foley`);
    expect(websiteJsonLd(new URL(origin))["@id"]).toBe(`${origin}/#website`);
  });
});

describe("websiteJsonLd", () => {
  const site = websiteJsonLd(SITE);

  it("is a schema.org WebSite published by the Organization", () => {
    expect(site["@type"]).toBe("WebSite");
    expect(site["@id"]).toBe("https://coloradostartups.org/#website");
    expect(site.url).toBe("https://coloradostartups.org/");
    expect(site.name).toBe("Colorado Startups");
    expect(site.publisher).toEqual({ "@id": organizationJsonLd(SITE)["@id"] });
  });
});

describe("homeJsonLd", () => {
  it("puts the Organization and the WebSite in one graph, so the home page writes one block", () => {
    expect(homeJsonLd(SITE)).toEqual({
      "@context": "https://schema.org",
      "@graph": [organizationJsonLd(SITE), websiteJsonLd(SITE)],
    });
  });
});

describe("organizationRef", () => {
  it("points at the Organization by @id and carries no other facts", () => {
    expect(organizationRef(SITE)).toEqual({
      "@type": "Organization",
      "@id": "https://coloradostartups.org/#organization",
      name: "Colorado Startups",
      url: "https://coloradostartups.org/",
    });
  });
});

describe("the ways in", () => {
  it("are the four the lane contract names, in order, each through WAYS_IN", () => {
    expect(WAYS.map((w) => w.kind)).toEqual(["slack", "linkedin-group", "linkedin-page", "newsletter"]);
    for (const way of WAYS) expect(way.href).toBe(WAYS_IN[way.kind]);
  });

  // #186: the home page's copy had drifted from /community/'s ("Ask a question"
  // against "Ask for help"). Each way now reads its channel, so they match.
  it("say what their channel on /community/ says", () => {
    for (const way of WAYS) {
      const channel = CHANNELS.find((c) => c.id === way.kind)!;
      expect({ name: way.name, action: way.action, href: way.href, what: way.what }, way.kind).toEqual({
        name: channel.name,
        action: channel.action.label,
        href: channel.action.href,
        what: channel.expect,
      });
    }
  });

  // #128: one click on "Join the Slack" opens the form. /slack/ is a short
  // link; site/test/unit/l6/redirects.test.ts checks that it ends at the form.
  it("send Slack through the /slack/ short link, never straight to the form", () => {
    expect(WAYS.find((w) => w.kind === "slack")?.href).toBe("/slack/");
    for (const way of WAYS) expect(way.href).not.toMatch(/docs\.google\.com/);
  });
});

describe("the channels on /community/", () => {
  it("each say what to expect, list at least one norm and offer one action", () => {
    for (const c of CHANNELS) {
      expect(c.expect.length, c.id).toBeGreaterThan(10);
      expect(c.norms.length, c.id).toBeGreaterThan(0);
      expect(c.action.href, c.id).toMatch(/^(\/|https:\/\/)/);
    }
  });

  it("send self-promotion to the Wednesday Asks and Offers thread in both groups", () => {
    for (const id of ["slack", "linkedin-group"]) {
      const norms = CHANNELS.find((c) => c.id === id)!.norms.join(" ");
      expect(norms, id).toMatch(/Wednesday Asks and Offers/);
    }
  });

  it("point the founders forum at /founders/ and never give it a date", () => {
    const forum = CHANNELS.find((c) => c.id === "founders-forum")!;
    expect(forum.action.href).toBe("/founders/");
    expect(forum.expect).toMatch(/opens later/);
    expect(forum.expect).not.toMatch(/\b20\d\d\b|January|February|March|April|May|June|July|August|September|October|November|December/);
  });
});
