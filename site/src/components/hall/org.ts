// Who Colorado Startups is, for the home page lede, its meta description and
// the site's JSON-LD. Owner: L1.
//
// One set of entity facts (GO-LIVE C3): the home page declares the
// Organization and the WebSite in full. Every other page points at them by
// @id, so search engines and AI assistants read one Colorado Startups.
import { WAYS_IN } from "@cs/shared";

// Decision 46. The meta description and the home page lede both open with it.
export const TAGLINE = "A community of founders building companies in Colorado.";

export const ORG_NAME = "Colorado Startups";

// The GitHub organization this repo lives in (the git remote, and
// ops/github/settings.md step 7).
export const GITHUB_ORG = "https://github.com/Colorado-Startups";

/** Stable JSON-LD ids, built from the site origin so staging describes itself. */
export const orgId = (site: URL) => new URL("/#organization", site).toString();
export const websiteId = (site: URL) => new URL("/#website", site).toString();
/** A person on /team/. PersonCard renders id={person.id}, so the fragment lands on the card. */
export const personId = (site: URL, id: string) => new URL(`/team/#${id}`, site).toString();

// The postal address as SiteFooter.astro prints it. The footer is
// orchestrator-owned, so this is a second copy; a DOM test in
// test/dom/l1/ fails if the two ever disagree.
export const ADDRESS = {
  streetAddress: "951 20th Street, Unit 2194",
  addressLocality: "Denver",
  addressRegion: "CO",
  postalCode: "80201",
  addressCountry: "US",
} as const;

/**
 * The schema.org Organization node, the one place its facts live. Every URL is
 * absolute, built from the site origin. sameAs names the profiles Colorado
 * Startups holds elsewhere: the LinkedIn Page and the LinkedIn Group (in the
 * order of LinkedIn W1 website-changes.md item 4), then the GitHub
 * organization. An on-site page is not a sameAs, so /links/ is not listed.
 */
export function organizationJsonLd(site: URL): Record<string, unknown> {
  const abs = (path: string) => new URL(path, site).toString();
  return {
    "@type": "Organization",
    "@id": orgId(site),
    name: ORG_NAME,
    legalName: "Colorado Startups, Ltd.",
    url: abs("/"),
    logo: abs("/brand/cs-logo-1500.png"),
    description: TAGLINE,
    // The BRIEF, section 1: founded in 2014 by Paul Foley.
    foundingDate: "2014",
    founder: { "@type": "Person", "@id": personId(site, "paul-foley"), name: "Paul Foley" },
    address: { "@type": "PostalAddress", ...ADDRESS },
    sameAs: [WAYS_IN["linkedin-page"], WAYS_IN["linkedin-group"], GITHUB_ORG],
  };
}

/** The schema.org WebSite node. The site has no search URL, so no SearchAction. */
export function websiteJsonLd(site: URL): Record<string, unknown> {
  return {
    "@type": "WebSite",
    "@id": websiteId(site),
    url: new URL("/", site).toString(),
    name: ORG_NAME,
    description: TAGLINE,
    inLanguage: "en-US",
    publisher: { "@id": orgId(site) },
  };
}

/** The home page's JSON-LD: both nodes in one graph, so BaseLayout writes one block. */
export function homeJsonLd(site: URL): Record<string, unknown> {
  return { "@context": "https://schema.org", "@graph": [organizationJsonLd(site), websiteJsonLd(site)] };
}

/**
 * How any other page names Colorado Startups: the home page's @id, plus the
 * name and url for parsers that do not follow an @id across pages. No other
 * facts, so they cannot drift from the home page.
 */
export function organizationRef(site: URL): Record<string, unknown> {
  return { "@type": "Organization", "@id": orgId(site), name: ORG_NAME, url: new URL("/", site).toString() };
}
