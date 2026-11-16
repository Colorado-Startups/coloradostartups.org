// The five /mcp tools as pure functions over the open data: search, events,
// region, path and company. No SDK imports, so test/unit/mcp/tools.test.ts
// runs them in plain Node. Every list holds at most MAX_RESULTS items, and
// every link is absolute on the origin the request came to.
import { SUBSTAGES, type OpenEvent, type OpenRegion, type RegionId, type ResourceCard, type Stage } from "@cs/shared";

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

// The query words a record holds: each one found in the name or, failing
// that, in the rest of the text. A word matches as a prefix.
function matches(query: readonly string[], name: string, rest: string) {
  const inName = new Set(words(name));
  const inRest = new Set(words(rest));
  const named: string[] = [];
  const other: string[] = [];
  for (const w of query) {
    if ([...inName].some((n) => n.startsWith(w))) named.push(w);
    else if ([...inRest].some((n) => n.startsWith(w))) other.push(w);
  }
  return { named, other };
}

// Each query word found in the name counts 3, in the rest of the text 1. A
// record with no query word scores 0 and is left out.
function score(query: readonly string[], name: string, rest: string): number {
  const { named, other } = matches(query, name, rest);
  return named.length * 3 + other.length;
}

const resourceText = (r: ResourceCard) => `${r.description} ${r.city} ${r.type} ${r.stage} ${r.substage}`;

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
      const s = score(query, r.name, resourceText(r));
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

export const PATH_STEPS = 5;
// At most this many steps of one resource type, so a path is not five
// investors in a row. Relaxed only when the stage has too few other types.
const PER_TYPE = 2;
// A listing in the founder's own region counts this much more than a
// statewide or online one.
const LOCAL_BONUS = 2;

export interface PathInput {
  stage: Stage;
  /** What the founder needs now, in their words. */
  need?: string;
  region?: RegionId;
}

const kindLabel = (type: string) => type.replace(/-/g, " ");
const withArticle = (noun: string) => `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;

function whyLine(r: ResourceCard, place: string, local: boolean, matched: readonly string[]): string {
  const where = local ? `in ${r.city}, in your region` : place === "elsewhere" ? `${r.city}, open statewide` : `in ${r.city}`;
  const fits = matched.length > 0 ? `; it covers ${matched.map((w) => `"${w}"`).join(", ")}` : "";
  return `${withArticle(kindLabel(r.type))} for the ${kindLabel(r.substage)} step of ${r.stage}, ${where}${fits}.`;
}

/**
 * A short path for a founder at one stage: up to five Startup Resources, best
 * fit first, then laid out in the order of the stage's substages. With a
 * region, listings in other regions are left out and local ones rank first.
 * With a need, only listings that mention it are kept, unless none do.
 */
export function path(data: OpenData, input: PathInput, origin: string) {
  const abs = (p: string) => new URL(p, origin).toString();
  const query = [...new Set(words(input.need ?? ""))];
  const order = SUBSTAGES[input.stage];

  const ranked = data.resources
    .filter((r) => r.stage === input.stage)
    .map((r) => {
      const place = regionOfResource(r.id, data.regions);
      const local = !!input.region && place === input.region;
      const { named, other } = matches(query, r.name, resourceText(r));
      const fit = named.length * 3 + other.length;
      return { r, place, local, matched: [...named, ...other], fit, rank: fit + (local ? LOCAL_BONUS : 0) };
    })
    .filter((c) => !input.region || c.local || c.place === "elsewhere");

  const fitting = ranked.filter((c) => c.fit > 0);
  const needMatched = query.length === 0 || fitting.length > 0;
  const pool = (query.length > 0 && fitting.length > 0 ? fitting : ranked).sort(
    (a, b) =>
      b.rank - a.rank ||
      order.indexOf(a.r.substage) - order.indexOf(b.r.substage) ||
      a.r.name.localeCompare(b.r.name, "en"),
  );

  const picked: typeof pool = [];
  const perType = new Map<string, number>();
  for (const c of pool) {
    if (picked.length === PATH_STEPS) break;
    const n = perType.get(c.r.type) ?? 0;
    if (n >= PER_TYPE) continue;
    perType.set(c.r.type, n + 1);
    picked.push(c);
  }
  for (const c of pool) {
    if (picked.length === PATH_STEPS) break;
    if (!picked.includes(c)) picked.push(c);
  }

  const steps = picked
    .map((c, i) => ({ c, i }))
    .sort((a, b) => order.indexOf(a.c.r.substage) - order.indexOf(b.c.r.substage) || a.i - b.i)
    .map(({ c }, n) => ({
      step: n + 1,
      id: c.r.id,
      name: c.r.name,
      kind: c.r.type,
      substage: c.r.substage,
      city: c.r.city,
      region: c.place,
      why: whyLine(c.r, c.place, c.local, c.matched),
      url: abs(`/ecosystem-canvas/#r-${c.r.id}`),
      website: c.r.url,
    }));

  let note: string | undefined;
  if (steps.length === 0) note = `No Startup Resources listed for the ${input.stage} stage${input.region ? " in that region" : ""} yet.`;
  else if (!needMatched) note = `No listing at this stage mentions "${input.need}", so this path covers the stage as a whole.`;

  return {
    stage: input.stage,
    need: input.need ?? null,
    region: input.region ?? null,
    steps,
    ...(note ? { note } : {}),
    more: abs("/ecosystem-canvas/"),
  };
}

/** One Leaderboard honoree's public record, or null for an id the Leaderboard does not have. */
export function company(data: OpenData, id: string, origin: string) {
  const c = data.companies.find((x) => x.id === id);
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    sector: c.sector,
    city: c.hq_city,
    region: c.region,
    ...(c.founded_year ? { founded: c.founded_year } : {}),
    boards: c.groups,
    website: c.website,
    sources: c.sources,
    url: new URL(`/leaderboard/#company-${c.id}`, origin).toString(),
  };
}
