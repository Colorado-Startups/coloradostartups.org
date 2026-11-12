// The city guides (lane L32). Each one lists the records Startup Resources
// places in the city, by what a founder needs, then a "Nearby in <region>"
// section.
//
// The nearby rule: a record is nearby when regionForCity() puts its town in
// the city's region, the town is not the city itself, and the town has no city
// guide of its own. So Denver and Boulder, both in Photon Mountain, never list
// each other's records; each links the other's guide instead. Statewide and
// online records stay off the city guides, because regionForCity() gives them
// no region; the topic guides list them.

import type { Region } from "@cs/shared";
import { cityKey, regionForCity } from "../regions/match";
import { andList } from "../regions/page";

import { CITY_GUIDES, CITY_SLUGS, type CitySlug, count, dated, everything, firstMatch, type GroupRules, guide, type Guide, type GuideInput, guideItems, guidePath, type GuideRecord, type GuideSection, hasTag, type Part, splitGroups } from "./core";

interface NeedRule {
  id: string;
  heading: string;
  /** How the answer names this section's records. */
  noun: string;
  intro: Part[];
  pick: (r: GuideRecord) => boolean;
  /** How the section splits its list, as for a topic guide's SectionRule. */
  groups?: GroupRules;
}

const isAngelGroup = (r: GuideRecord) => r.type === "event" && hasTag(r, ["investors"]);

// The sections of a city guide, in page order. No two picks match the same
// record, so each record has one place on the page.
export const CITY_NEEDS: readonly NeedRule[] = [
  {
    id: "accelerators",
    heading: "Accelerators and incubators",
    noun: "accelerators and incubators",
    intro: [
      "An accelerator is a mentor-led program for a company that is already building. ",
      "An incubator helps founders test an idea, build a team and set up the company.",
    ],
    pick: (r) => r.type === "accelerator" || r.type === "incubator",
    groups: [
      { heading: "Accelerators", pick: (r) => r.type === "accelerator" },
      { heading: "Incubators", pick: everything },
    ],
  },
  {
    id: "meet",
    heading: "Where founders meet",
    noun: "meetups and events",
    intro: [
      "Groups and events where founders learn, find cofounders and pitch. ",
      { text: "Startup events in Colorado", href: guidePath("colorado-startup-events") },
      " lists the next events on the Colorado Startups event calendar.",
    ],
    pick: (r) => (r.type === "community" || r.type === "event") && !isAngelGroup(r),
    groups: [
      { heading: "Meetups and communities", pick: (r) => r.type === "community" },
      { heading: "Events, pitch nights and hackathons", pick: everything },
    ],
  },
  {
    id: "coworking",
    heading: "Coworking spaces",
    noun: "coworking spaces",
    intro: ["Shared workspaces where founders rent a desk or an office."],
    pick: (r) => r.type === "coworking",
  },
  {
    id: "investors",
    heading: "Investors",
    noun: "investors",
    intro: ["A listing is not a recommendation, so ask other founders about an investor before you pitch."],
    pick: (r) => r.type === "investor" || isAngelGroup(r),
    groups: [
      { heading: "Angel groups", pick: isAngelGroup },
      { heading: "Seed and early rounds", pick: (r) => r.stage !== "growth" },
      { heading: "Growth rounds", pick: everything },
    ],
  },
  {
    id: "support",
    heading: "Funding and support programs",
    noun: "support programs",
    intro: [
      "Offices and programs that help local businesses start and grow. For statewide programs, see ",
      { text: "How to start a company in Colorado", href: guidePath("start-a-company-in-colorado") },
      ".",
    ],
    pick: (r) =>
      r.type === "government" ||
      r.type === "nonprofit" ||
      (r.type === "education" && hasTag(r, ["entrepreneurship", "skills"])),
  },
  {
    id: "universities",
    heading: "Universities",
    noun: "universities",
    intro: ["Universities and colleges that Startup Resources lists as support for founders."],
    pick: (r) => r.type === "university",
  },
];

/** One section per need, in order. A need that matches nothing comes back with no groups. */
function needSections(records: readonly GuideRecord[]): GuideSection[] {
  return firstMatch(records, CITY_NEEDS).map(([{ id, heading, intro, groups }, items]) => ({
    id,
    heading,
    intro,
    groups: splitGroups(items, groups),
  }));
}

/** "Boulder has its own guide." with a link, or "A and B have their own guides." */
function siblingGuides(slugs: readonly CitySlug[]): Part[] {
  const links = slugs.flatMap((s, i): Part[] => [
    ...(i === 0 ? [] : [i === slugs.length - 1 ? " and " : ", "]),
    { text: CITY_GUIDES[s], href: guidePath(s) },
  ]);
  return [...links, slugs.length === 1 ? " has its own guide." : " have their own guides."];
}

/** The region's other towns, under the nearby rule above, one group per need. */
function nearbySection(
  slug: CitySlug,
  region: Region,
  { records, regions, date }: Pick<GuideInput, "records" | "regions" | "date">,
): GuideSection {
  const guided = new Set(CITY_SLUGS.map((s) => cityKey(CITY_GUIDES[s])));
  const nearby = records.filter((r) => !guided.has(cityKey(r.city)) && regionForCity(r.city, regions) === region.id);
  const groups = needSections(nearby)
    .filter((s) => s.groups.length > 0)
    .map((s) => ({ heading: s.heading, items: guideItems({ sections: [s] }) }));
  const towns = [...new Set(groups.flatMap((g) => g.items.map((r) => r.city)))].sort((a, b) => a.localeCompare(b, "en"));
  const siblings = CITY_SLUGS.filter((s) => s !== slug && regionForCity(CITY_GUIDES[s], regions) === region.id);
  const n = groups.reduce((sum, g) => sum + g.items.length, 0);
  return {
    id: "nearby",
    heading: `Nearby in ${region.name}`,
    intro: [
      `Startup Resources lists ${n} more in ${andList(towns)}, ${towns.length === 1 ? "another town" : "other towns"} in ${region.name}, as of `,
      dated(date),
      ".",
      ...(siblings.length > 0 ? [" ", ...siblingGuides(siblings)] : []),
    ],
    groups,
  };
}

// One city's guide: its records by need, then nearby towns in its region.
export function cityGuide(slug: CitySlug, { records, regions, date }: GuideInput): Guide {
  const city = CITY_GUIDES[slug];
  const region = regions.find((r) => r.id === regionForCity(city, regions));
  if (!region) throw new Error(`${city} belongs to no region in data/regions/, so its guide cannot name one`);

  const own = records.filter((r) => cityKey(r.city) === cityKey(city));
  const needs = needSections(own);
  const shown = guideItems({ sections: needs }).length;
  const nearby = nearbySection(slug, region, { records, regions, date });
  const nouns = CITY_NEEDS.filter((_, i) => needs[i]!.groups.length > 0).map((n) => n.noun);
  const then = nearby.groups.length > 0 ? ", then towns nearby" : "";
  // Why the page lists fewer records than the city has: no need picks a service
  // provider, a large company or a coding school. Name the biggest reason.
  const listed = new Set(guideItems({ sections: needs }).map((r) => r.id));
  const rest = own.filter((r) => !listed.has(r.id));
  const providers = rest.filter((r) => r.type === "service-provider").length;
  const leftOut =
    providers * 2 > rest.length
      ? "; most of the rest are service providers"
      : providers > 0
        ? "; service providers are left out"
        : "";
  // The region's other core cities, or its nearby towns when the city is its only core city.
  const others = region.cities.filter((c) => cityKey(c) !== cityKey(city));
  const around = others.length > 0 ? others : region.nearby;

  return guide(
    slug,
    [
      `Startup Resources lists ${count(own.length, "resource", "resources")} for founders in ${city}, as of `,
      dated(date),
      shown > 0 ? `, and the lists below show ${shown} of them by need. ` : ". ",
      `${city} is in `,
      { text: region.name, href: `/regions/${region.id}/` },
      around.length > 0 ? `, the Colorado Startups region that also takes in ${andList(around)}.` : ", a Colorado Startups region.",
      nouns.length > 0 ? ` The lists cover ${andList(nouns)}${then}${leftOut}.` : "",
    ],
    [...needs, nearby],
  );
}
