// The three /mcp tools as pure functions over the open data: search, events
// and region. No SDK imports, so test/unit/mcp/tools.test.ts runs them in
// plain Node. Every list holds at most MAX_RESULTS items, and every link is
// absolute on the origin the request came to.
import type { OpenEvent, OpenRegion, RegionId } from "@cs/shared";

import type { OpenData } from "./data";

export const MAX_RESULTS = 25;
export const SEARCH_TYPES = ["resource", "company", "guide"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

const TIME_ZONE = "America/Denver";

export interface Hit {
  type: SearchType;
  id: string;
  name: string;
  description: string;
  /** The page on this site that shows it. */
  url: string;
  /** Its own website, for a resource or a company. */
  website?: string;
  city?: string;
  region?: string;
  kind?: string;
}

/** Lowercase words of two or more letters or digits. */
export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

// Each query word found in the name counts 3, in the rest of the text 1. A
// record with no query word scores 0 and is left out.
function score(query: readonly string[], name: string, rest: string): number {
  const inName = new Set(words(name));
  const inRest = new Set(words(rest));
  let total = 0;
  for (const w of query) {
    if ([...inName].some((n) => n.startsWith(w))) total += 3;
    else if ([...inRest].some((n) => n.startsWith(w))) total += 1;
  }
  return total;
}

function regionOfResource(id: string, regions: readonly OpenRegion[]): RegionId | "elsewhere" {
  return regions.find((r) => r.resources.includes(id))?.id ?? "elsewhere";
}

export interface SearchInput {
  words: string;
  type?: SearchType;
  region?: RegionId;
}

/** Resources, companies and guides that match the words, best first. */
export function search(data: OpenData, input: SearchInput, origin: string): Hit[] {
  const query = [...new Set(words(input.words))];
  if (query.length === 0) return [];
  const abs = (path: string) => new URL(path, origin).toString();
  const hits: { hit: Hit; score: number }[] = [];
  const want = (t: SearchType) => !input.type || input.type === t;
  const inRegion = (r: string) => !input.region || input.region === r;

  if (want("resource")) {
    for (const r of data.resources) {
      const region = regionOfResource(r.id, data.regions);
      if (!inRegion(region)) continue;
      const s = score(query, r.name, `${r.description} ${r.city} ${r.type} ${r.stage} ${r.substage}`);
      if (s > 0) {
        hits.push({
          score: s,
          hit: {
            type: "resource",
            id: r.id,
            name: r.name,
            description: r.description,
            url: abs(`/ecosystem-canvas/#r-${r.id}`),
            website: r.url,
            city: r.city,
            region,
            kind: r.type,
          },
        });
      }
    }
  }
  if (want("company")) {
    for (const c of data.companies) {
      if (!inRegion(c.region)) continue;
      const s = score(query, c.name, `${c.description} ${c.sector} ${c.hq_city}`);
      if (s > 0) {
        hits.push({
          score: s,
          hit: {
            type: "company",
            id: c.id,
            name: c.name,
            description: c.description,
            url: abs("/leaderboard/"),
            website: c.website,
            city: c.hq_city,
            region: c.region,
            kind: c.sector,
          },
        });
      }
    }
  }
  if (want("guide")) {
    for (const g of data.guides) {
      if (!inRegion(g.region)) continue;
      const s = score(query, g.title, `${g.description} ${g.answer}`);
      if (s > 0) {
        hits.push({
          score: s,
          hit: { type: "guide", id: g.id, name: g.title, description: g.description, url: abs(g.url), region: g.region },
        });
      }
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name, "en"))
    .slice(0, MAX_RESULTS)
    .map((h) => h.hit);
}

/** Today in Denver, as YYYY-MM-DD. */
export function denverToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export interface EventsInput {
  /** First day, YYYY-MM-DD in Mountain Time. Default: today. */
  from?: string;
  /** Last day, YYYY-MM-DD in Mountain Time. Default: no end. */
  to?: string;
  region?: RegionId;
}

// An event's start and end carry Denver's local date in their first ten
// characters, for all-day events and timed ones alike.
const localDay = (value: string) => value.slice(0, 10);

/** Events on the calendar between two days, soonest first. */
export function events(data: OpenData, input: EventsInput, now: Date): OpenEvent[] {
  const from = input.from ?? denverToday(now);
  return data.events
    .filter((e) => localDay(e.end) >= from && (!input.to || localDay(e.start) <= input.to))
    .filter((e) => !input.region || e.region === input.region)
    .slice(0, MAX_RESULTS);
}

/** One region: its page, cities and counts, then up to 25 of its listings, honorees and events. */
export function region(data: OpenData, id: RegionId, origin: string, now: Date) {
  const r = data.regions.find((x) => x.id === id);
  if (!r) return null;
  const abs = (path: string) => new URL(path, origin).toString();
  const resources = data.resources.filter((c) => r.resources.includes(c.id));
  const companies = data.companies.filter((c) => c.region === id);
  const upcoming = events(data, { region: id }, now);
  return {
    id: r.id,
    name: r.name,
    summary: r.summary,
    url: abs(r.url),
    cities: r.cities,
    nearby: r.nearby,
    counts: { resources: resources.length, companies: companies.length, upcomingEvents: upcoming.length },
    resources: resources.slice(0, 10).map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city,
      kind: c.type,
      url: abs(`/ecosystem-canvas/#r-${c.id}`),
      website: c.url,
    })),
    companies: companies.slice(0, 10).map((c) => ({ id: c.id, name: c.name, city: c.hq_city, sector: c.sector, website: c.website })),
    events: upcoming.slice(0, 5),
  };
}
