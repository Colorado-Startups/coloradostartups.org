// The answer pages under /guides/ (lane L23). Pure shaping with no Astro
// imports: the pages load the records and the regions and pass them in, and
// test/unit/l23/guides.test.ts runs every builder in plain Node.
//
// Every list comes from Startup Resources (data/resources/, active records
// only). A guide picks records by type, stage, substage, tags or region, never
// by a hand-kept list of ids, so a new record lands in the right guide on the
// next build. Every count a page states carries its source and the build date
// in the same sentence ("Startup Resources lists ... as of October 18, 2026").
//
// Hard constraints 2 and 8 (BRIEF section 2): the funding guide lists what
// Startup Resources lists and nothing else. It never mentions a Colorado
// Startups fund and never links the Leaderboard.
//
// Lane L32 added the four city guides and the events guide. They follow the
// same rules, and test/unit/l32/ covers them.
//
// The builders live in topics.ts, cities.ts and events.ts, on core.ts's
// shared shape; this file routes a slug to its builder and writes the JSON-LD,
// and re-exports what the pages import.

import { cityGuide } from "./cities";
import { type Guide, type GuideInput, guideItems, GUIDES_INDEX, type GuideSlug } from "./core";
import { startupEvents } from "./events";
import { acceleratorsAndIncubators, fundingPrograms, startACompany, whereFoundersMeet } from "./topics";

export { CITY_NEEDS } from "./cities";
export { type AsOf, asOf, canvasHref, CITY_GUIDES, CITY_SLUGS, type CitySlug, type Guide, GUIDE_GROUPS, GUIDE_SLUGS, type GuideInput, guideItems, type GuideMeta, guidePath, type GuideRecord, GUIDES, GUIDES_INDEX, type GuideSlug, mostIn, otherGuides, type Part, plainText, type UpcomingList } from "./core";
export { byCity, EVENT_CALENDAR, UPCOMING_LIMIT, upcomingList } from "./events";

// Builds one guide's page content from the build's records, through that
// slug's builder in BUILDERS.
export function buildGuide(slug: GuideSlug, input: GuideInput): Guide {
  return BUILDERS[slug](input);
}

const BUILDERS: Record<GuideSlug, (input: GuideInput) => Guide> = {
  "start-a-company-in-colorado": startACompany,
  "colorado-accelerators-and-incubators": acceleratorsAndIncubators,
  "where-founders-meet": whereFoundersMeet,
  "funding-programs": fundingPrograms,
  "startups-in-denver": (input) => cityGuide("startups-in-denver", input),
  "startups-in-boulder": (input) => cityGuide("startups-in-boulder", input),
  "startups-in-colorado-springs": (input) => cityGuide("startups-in-colorado-springs", input),
  "startups-in-fort-collins": (input) => cityGuide("startups-in-fort-collins", input),
  "colorado-startup-events": startupEvents,
};

/** The schema.org ItemList for a guide: every listed record, in page order. */
export function guideJsonLd(guide: Guide, site: URL): Record<string, unknown> {
  const items = guideItems(guide);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: guide.title,
    description: guide.description,
    url: new URL(guide.path, site).toString(),
    numberOfItems: items.length,
    // A to Z within each group: an order of convenience, never a ranking.
    itemListOrder: "https://schema.org/ItemListUnordered",
    itemListElement: items.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.name, url: r.url })),
  };
}

/**
 * The schema.org ItemList for /guides/: the guides, in index order. Takes
 * titles and paths only, so the startup credits guide (lib/guides/credits.ts),
 * which is not built from Startup Resources, can join the list.
 */
export function guidesIndexJsonLd(guides: readonly Pick<Guide, "title" | "path">[], site: URL): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: GUIDES_INDEX.title,
    description: GUIDES_INDEX.description,
    url: new URL(GUIDES_INDEX.path, site).toString(),
    numberOfItems: guides.length,
    itemListElement: guides.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: g.title,
      url: new URL(g.path, site).toString(),
    })),
  };
}
