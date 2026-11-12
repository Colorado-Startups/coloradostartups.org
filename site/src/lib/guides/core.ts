// The guides' shared shape (guides.ts and its builders in topics.ts,
// cities.ts and events.ts): the types, each guide's metadata, the index, and
// the helpers every builder uses to pick records and lay out sections.
import type { Region, ResourceCard } from "@cs/shared";
import type { Snapshot } from "../../components/events/events";
import { countBy } from "../leaderboard/board";
import { NOT_CITIES } from "../regions/match";
import { andList } from "../regions/page";

/** A Startup Resources card plus its tags, which some guides select on. */
export type GuideRecord = ResourceCard & { tags: readonly string[] };

/** Inline text: plain words, a link, or a date. */
export type Part = string | { text: string; href: string } | { text: string; datetime: string };

export interface GuideGroup {
  /** Shown as an h3 when the section splits its list. */
  heading?: string;
  items: GuideRecord[];
}

/** One headed section of a guide: its id, heading, intro and grouped records. */
export interface GuideSection {
  /** The section's anchor on the page. */
  id: string;
  heading: string;
  intro: Part[];
  groups: GuideGroup[];
}

export interface GuideMeta {
  slug: GuideSlug;
  /** The <title>; BaseLayout adds "| Colorado Startups". Also the h1. */
  title: string;
  description: string;
}

export interface Guide extends GuideMeta {
  path: string;
  /** Two or three sentences that answer the question, count and source included. */
  answer: Part[];
  /** The next events on the calendar, shown ahead of the lists. Only the events guide has them. */
  upcoming?: UpcomingList;
  sections: GuideSection[];
}

/** One calendar event as the events guide shows it, in Mountain Time. */
interface UpcomingEvent {
  id: string;
  title: string;
  url: string | null;
  /** The <time datetime> value: the start as the calendar gives it. */
  datetime: string;
  /** "Wed, Oct 21" */
  day: string;
  /** "5:30 PM to 7:30 PM", or "All day" */
  time: string;
  where: string | null;
}

export interface UpcomingList {
  id: string;
  heading: string;
  intro: Part[];
  events: UpcomingEvent[];
}

/** The day the lists were built, as a reader sees it and as a <time> value. */
export interface AsOf {
  label: string;
  iso: string;
}

export interface GuideInput {
  /** Active records only, A to Z by name. */
  records: readonly GuideRecord[];
  /** data/regions/, in display order. */
  regions: readonly Region[];
  date: AsOf;
  /**
   * The event calendar snapshot (data/events/upcoming.json) and the build
   * time. Without it, or with no events left in it, the events guide lists
   * only the event records from Startup Resources.
   */
  calendar?: { snapshot: Snapshot | null; now: Date };
}

export const GUIDE_SLUGS = [
  "start-a-company-in-colorado",
  "colorado-accelerators-and-incubators",
  "where-founders-meet",
  "funding-programs",
  "startups-in-denver",
  "startups-in-boulder",
  "startups-in-colorado-springs",
  "startups-in-fort-collins",
  "colorado-startup-events",
] as const;
export type GuideSlug = (typeof GUIDE_SLUGS)[number];

// The city guides, slug to city as resource.city spells it: the four cities
// with the most active records in data/resources/.
export const CITY_GUIDES = {
  "startups-in-denver": "Denver",
  "startups-in-boulder": "Boulder",
  "startups-in-colorado-springs": "Colorado Springs",
  "startups-in-fort-collins": "Fort Collins",
} as const satisfies Partial<Record<GuideSlug, string>>;
export type CitySlug = keyof typeof CITY_GUIDES;
export const CITY_SLUGS = Object.keys(CITY_GUIDES) as CitySlug[];

export const GUIDES: Record<GuideSlug, GuideMeta> = {
  "start-a-company-in-colorado": {
    slug: "start-a-company-in-colorado",
    title: "How to start a company in Colorado",
    description:
      "How to start a company in Colorado: learn the basics, test the idea, register with the Secretary of State, then find a lawyer, an accountant and a bank.",
  },
  "colorado-accelerators-and-incubators": {
    slug: "colorado-accelerators-and-incubators",
    title: "Accelerators and incubators in Colorado",
    description:
      "Every accelerator and incubator listed in Startup Resources, the directory for Colorado founders, with each program's city and website.",
  },
  "where-founders-meet": {
    slug: "where-founders-meet",
    title: "Where founders meet in Colorado",
    description:
      "Meetups, pitch nights, hackathons and coworking spaces where Colorado founders meet, by region: Photon Mountain, Space Peak and Fusion Canyon.",
  },
  "funding-programs": {
    slug: "funding-programs",
    title: "Funding programs for Colorado startups",
    description:
      "Angel groups, pitch events, seed and growth-stage investors, and banks listed in Startup Resources for founders building in Colorado.",
  },
  "startups-in-denver": {
    slug: "startups-in-denver",
    title: "Startup resources in Denver",
    description:
      "Where founders in Denver find accelerators, meetups, coworking, investors, support programs and universities, from Startup Resources.",
  },
  "startups-in-boulder": {
    slug: "startups-in-boulder",
    title: "Startup resources in Boulder",
    description:
      "Accelerators, meetups, pitch nights, coworking, investors and support programs for founders in Boulder, each listed in Startup Resources.",
  },
  "startups-in-colorado-springs": {
    slug: "startups-in-colorado-springs",
    title: "Startup resources in Colorado Springs",
    description:
      "Where founders in Colorado Springs find incubators, meetups, coworking, support programs and universities, from Startup Resources.",
  },
  "startups-in-fort-collins": {
    slug: "startups-in-fort-collins",
    title: "Startup resources in Fort Collins",
    description:
      "Incubators, startup weeks, meetups, coworking and support programs for founders in Fort Collins and the towns near it, from Startup Resources.",
  },
  "colorado-startup-events": {
    slug: "colorado-startup-events",
    title: "Startup events in Colorado",
    description:
      "Where to find startup events in Colorado: the Colorado Startups event calendar, the next events on it, and the events and groups Startup Resources lists, by city.",
  },
};

/** How the index and each guide's "More guides" list group the guides. */
export const GUIDE_GROUPS: readonly { heading: string; slugs: readonly GuideSlug[] }[] = [
  {
    heading: "Start and fund a company",
    slugs: ["start-a-company-in-colorado", "colorado-accelerators-and-incubators", "funding-programs"],
  },
  { heading: "Meet other founders", slugs: ["where-founders-meet", "colorado-startup-events"] },
  { heading: "Guides by city", slugs: CITY_SLUGS },
];

/** The other guides, by group, for the foot of one guide. A group left empty drops out. */
export function otherGuides(slug: GuideSlug): { heading: string; guides: GuideMeta[] }[] {
  return GUIDE_GROUPS.map((g) => ({
    heading: g.heading,
    guides: g.slugs.filter((s) => s !== slug).map((s) => GUIDES[s]),
  })).filter((g) => g.guides.length > 0);
}

export const GUIDES_INDEX = {
  path: "/guides/",
  title: "Guides for Colorado founders",
  description:
    "Short answers to the questions founders ask about building a company in Colorado, by topic and by city, each with a list from Startup Resources.",
} as const;

// The office that registers Colorado companies (title of the page, read
// 2026-10-18). The one link on these pages that is not a listed record.
export const SECRETARY_OF_STATE = "https://www.coloradosos.gov/";

// The site path of one guide: /guides/<slug>/.
export const guidePath = (slug: GuideSlug): string => `/guides/${slug}/`;

/** The record's own entry in the directory (L3 gives each one id="r-<id>"). */
export const canvasHref = (id: string): string => `/ecosystem-canvas/#r-${id}`;

/** The build date in Denver: "October 18, 2026" and "2026-10-18". */
export function asOf(date: Date): AsOf {
  const zone = { timeZone: "America/Denver" } as const;
  const label = date.toLocaleDateString("en-US", { ...zone, year: "numeric", month: "long", day: "numeric" });
  // en-CA writes dates as YYYY-MM-DD, the form <time datetime> takes.
  const iso = date.toLocaleDateString("en-CA", { ...zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return { label, iso };
}

/** Every record a guide lists, in page order. */
export function guideItems(guide: Pick<Guide, "sections">): GuideRecord[] {
  return guide.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
}

/** The words of some parts, links and dates included. */
export function plainText(parts: readonly Part[]): string {
  return parts.map((p) => (typeof p === "string" ? p : p.text)).join("");
}

// True when the record carries any of the tags.
export const hasTag = (r: GuideRecord, tags: readonly string[]) => r.tags.some((t) => tags.includes(t));
// A number with its noun: "1 place", "3 places".
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// The build date as a <time> part.
export const dated = (date: AsOf): Part => ({ text: date.label, datetime: date.iso });

// A guide from its metadata, answer and sections; a section with no groups drops out.
export function guide(slug: GuideSlug, answer: Part[], sections: GuideSection[], upcoming?: UpcomingList): Guide {
  return {
    ...GUIDES[slug],
    path: guidePath(slug),
    answer,
    ...(upcoming ? { upcoming } : {}),
    sections: sections.filter((s) => s.groups.length > 0),
  };
}

/**
 * How a section splits its list into h3 groups, in page order. A record goes
 * to the first group it matches, so end with a group that picks everything:
 * it takes the rest, and no record drops off the page.
 */
export type GroupRules = readonly { heading: string; pick: (r: GuideRecord) => boolean }[];

// A pick that takes every record.
export const everything = () => true;

interface SectionRule {
  id: string;
  heading: string;
  intro: Part[];
  pick: (r: GuideRecord) => boolean;
  /** Without groups, the section shows one list with no h3. */
  groups?: GroupRules;
}

/** Each rule with the records it takes, in rule order. A record goes to the first rule it matches. */
export function firstMatch<R extends { pick: (r: GuideRecord) => boolean }>(
  records: readonly GuideRecord[],
  rules: readonly R[],
): [R, GuideRecord[]][] {
  const taken = new Set<string>();
  return rules.map((rule) => {
    const items = records.filter((r) => !taken.has(r.id) && rule.pick(r));
    for (const r of items) taken.add(r.id);
    return [rule, items];
  });
}

/**
 * One section per rule, in rule order, so no record shows twice on a page. A
 * rule that matches nothing yields a section with no groups, which guide() drops.
 */
export function sectionsByRule(rules: readonly SectionRule[], records: readonly GuideRecord[]): GuideSection[] {
  return firstMatch(records, rules).map(([{ pick, groups, ...section }, items]) => ({
    ...section,
    groups: splitGroups(items, groups),
  }));
}

/** "most of them in Boulder and Denver" when the two busiest cities hold more than half. */
export function mostIn(items: readonly GuideRecord[]): string | undefined {
  const top = countBy(items, (r) => (NOT_CITIES.has(r.city) ? undefined : r.city)).slice(0, 2);
  const held = top.reduce((n, c) => n + c.count, 0);
  if (top.length === 0 || held * 2 <= items.length) return undefined;
  return `${held === items.length ? "all" : "most"} of them in ${andList(top.map((c) => c.key))}`;
}

/** Splits a list into headed groups, each item in the first group it matches. */
export function splitGroups(items: readonly GuideRecord[], rules: GroupRules | undefined): GuideGroup[] {
  if (items.length === 0) return [];
  if (!rules) return [{ items: [...items] }];
  return firstMatch(items, rules)
    .map(([{ heading }, group]) => ({ heading, items: group }))
    .filter((g) => g.items.length > 0);
}
