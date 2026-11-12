// The four topic guides (lane L23): start a company, accelerators and
// incubators, where founders meet, and funding programs. guides.ts routes to
// them through BUILDERS.
import { type ResourceCard, WAYS_IN } from "@cs/shared";
import { ELSEWHERE, NOT_CITIES, regionForCity } from "../regions/match";
import { andList } from "../regions/page";

import { count, dated, everything, guide, type Guide, type GuideGroup, type GuideInput, guideItems, type GuideRecord, type GuideSection, hasTag, mostIn, SECRETARY_OF_STATE, sectionsByRule } from "./core";

// The start-a-company guide's lawyers, by place, as the where-founders-meet
// guide splits its lists: the two cities with the most, other towns, then
// statewide and online. As one list they ran about 7,800 px on a phone (#723).
// A record goes to the first place that fits.
const LAWYER_PLACES: readonly { heading: string; at: (r: GuideRecord) => boolean }[] = [
  { heading: "Lawyers in Denver", at: (r) => r.city === "Denver" },
  { heading: "Lawyers in Boulder", at: (r) => r.city === "Boulder" },
  { heading: "Lawyers in other Colorado towns", at: (r) => !NOT_CITIES.has(r.city) },
  { heading: "Lawyers statewide and online", at: everything },
];

// "How to start a company in Colorado": learn, test the idea, get help, then a lawyer, an accountant and a bank.
export function startACompany({ records, date }: GuideInput): Guide {
  const sections = sectionsByRule(
    [
      {
        id: "learn",
        heading: "Learn the basics",
        intro: ["Classes and programs that teach founders how to start a company."],
        pick: (r) => r.type === "education" && hasTag(r, ["entrepreneurship", "skills"]),
      },
      {
        id: "test",
        heading: "Test the idea and find a team",
        intro: ["Meetups and hackathons where founders test an idea and find cofounders."],
        pick: (r) => r.stage === "idea" && r.substage === "validate",
        // The same split as the where-founders-meet guide. The stage picks the
        // section, not the type, so a record of any other type goes last.
        groups: [
          ...MEETING_TYPES.map(({ type, heading }) => ({ heading, pick: (r: GuideRecord) => r.type === type })),
          { heading: "Other resources", pick: everything },
        ],
      },
      {
        id: "local-help",
        heading: "Get help from business support offices",
        intro: ["Chambers of commerce, economic development offices and statewide business programs."],
        pick: (r) => r.type === "government",
      },
      {
        id: "advisers",
        heading: "Find a lawyer, an accountant and a bank",
        intro: ["Firms that help founders form the company, keep the books and open accounts."],
        pick: (r) => r.type === "service-provider" && hasTag(r, ["legal", "accounting", "banking"]),
        // In the heading's order. The section's pick needs one of the three
        // tags, so what is neither legal nor accounting is banking.
        groups: [
          ...LAWYER_PLACES.map(({ heading, at }) => ({ heading, pick: (r: GuideRecord) => hasTag(r, ["legal"]) && at(r) })),
          { heading: "Accountants", pick: (r) => hasTag(r, ["accounting"]) },
          { heading: "Banks", pick: everything },
        ],
      },
    ],
    records,
  );
  const n = guideItems({ sections }).length;
  return guide(
    "start-a-company-in-colorado",
    [
      "To start a company in Colorado, learn the basics, test the idea with real customers, then register the company with the ",
      { text: "Colorado Secretary of State", href: SECRETARY_OF_STATE },
      ". Classes, meetups, business support offices, lawyers, accountants and banks help at each step. ",
      `This guide lists ${n} of them from Startup Resources, as of `,
      dated(date),
      ".",
    ],
    sections,
  );
}

// "Accelerators and incubators in Colorado", by kind of program.
export function acceleratorsAndIncubators({ records, date }: GuideInput): Guide {
  const sections = sectionsByRule(
    [
      {
        id: "accelerators",
        heading: "Accelerators",
        intro: ["Mentor-led programs for companies that are already building, A to Z."],
        pick: (r) => r.type === "accelerator",
      },
      {
        id: "incubators",
        heading: "Incubators",
        intro: ["Programs that help founders test an idea, build a team and set up the company, A to Z."],
        pick: (r) => r.type === "incubator",
      },
    ],
    records,
  );
  const all = guideItems({ sections });
  const accelerators = all.filter((r) => r.type === "accelerator").length;
  const where = mostIn(all);
  return guide(
    "colorado-accelerators-and-incubators",
    [
      `Startup Resources lists ${count(accelerators, "accelerator", "accelerators")} and ${count(all.length - accelerators, "incubator", "incubators")} in Colorado as of `,
      dated(date),
      where ? `, ${where}. ` : ". ",
      "An accelerator is a mentor-led program for a company that is already building. ",
      "An incubator helps founders test an idea, build a team and set up the company.",
    ],
    sections,
  );
}

// Where founders meet: groups, events and shared space. Each region's list
// splits by type, in this order, and so does the start-a-company guide's
// "Test the idea" list.
const MEETING_TYPES: readonly { type: ResourceCard["type"]; heading: string }[] = [
  { type: "community", heading: "Meetups and communities" },
  { type: "event", heading: "Events, pitch nights and hackathons" },
  { type: "coworking", heading: "Coworking spaces" },
];

function byMeetingType(items: readonly GuideRecord[]): GuideGroup[] {
  return MEETING_TYPES.map(({ type, heading }) => ({ heading, items: items.filter((r) => r.type === type) })).filter(
    (g) => g.items.length > 0,
  );
}

// "Where founders meet in Colorado": groups, spaces and events, by region.
export function whereFoundersMeet({ records, regions, date }: GuideInput): Guide {
  const meet = records.filter((r) => MEETING_TYPES.some((m) => m.type === r.type));
  const place = (r: GuideRecord) => (NOT_CITIES.has(r.city) ? "statewide" : regionForCity(r.city, regions));

  const regionSections: GuideSection[] = regions.map((region) => {
    const items = meet.filter((r) => place(r) === region.id);
    return {
      id: region.id,
      heading: region.name,
      intro: [
        `${region.tagline} Startup Resources lists ${count(items.length, "place", "places")} around ${andList(region.cities)}. `,
        { text: `Visit the ${region.name} page`, href: `/regions/${region.id}/` },
        " for the region's Connector seat and its full list of resources.",
      ],
      groups: byMeetingType(items),
    };
  });
  const sections = [
    ...regionSections,
    {
      id: "statewide",
      heading: "Statewide and online",
      intro: ["Groups and events that serve founders across Colorado, or meet online."],
      groups: byMeetingType(meet.filter((r) => place(r) === "statewide")),
    },
    {
      id: ELSEWHERE,
      heading: "Elsewhere in Colorado",
      intro: ["Places outside the regions above."],
      groups: byMeetingType(meet.filter((r) => place(r) === ELSEWHERE)),
    },
  ];

  const sizes = regionSections.map((s) => ({ name: s.heading, n: guideItems({ sections: [s] }).length }));
  const most = [...sizes].sort((a, b) => b.n - a.n);
  const leader = most[0] && most[0].n > (most[1]?.n ?? 0) ? `, with the most in ${most[0].name}` : "";
  return guide(
    "where-founders-meet",
    [
      "Colorado founders meet at meetups, pitch nights, hackathons and coworking spaces, and online in the ",
      { text: "Colorado Startups Slack", href: WAYS_IN.slack },
      `. Startup Resources lists ${guideItems({ sections }).length} of these places as of `,
      dated(date),
      `${leader}. `,
      `The lists below run by region (${andList(regions.map((r) => r.name))}), then statewide and online.`,
    ],
    sections,
  );
}

// "Funding programs for Colorado startups", by round, with no fund of our own (BRIEF constraints 2 and 8).
export function fundingPrograms({ records, date }: GuideInput): Guide {
  const sections = sectionsByRule(
    [
      {
        id: "angels-and-pitch-events",
        heading: "Angel groups and pitch events",
        intro: ["Groups and events where founders pitch to investors."],
        pick: (r) => r.type === "event" && hasTag(r, ["investors", "pitch"]),
      },
      {
        id: "seed",
        heading: "Seed and early-stage funding",
        intro: ["Firms and resources for a company raising its first rounds."],
        pick: (r) => r.stage === "launch" && r.substage === "investors",
      },
      {
        id: "growth",
        heading: "Growth-stage funding",
        intro: ["Firms for later rounds, from seed-plus to Series C and private equity."],
        pick: (r) => r.stage === "growth" && r.substage === "investors",
      },
      {
        id: "banks",
        heading: "Banks and lenders",
        intro: ["Banks, credit unions and business banking services."],
        pick: (r) => r.type === "service-provider" && hasTag(r, ["banking"]),
      },
    ],
    records,
  );
  const sizes = sections.map((s) => guideItems({ sections: [s] }).length);
  const [angels = 0, seed = 0, growth = 0, banks = 0] = sizes;
  return guide(
    "funding-programs",
    [
      "Colorado founders raise money through angel groups, pitch events, venture capital firms and banks. ",
      `Startup Resources lists ${angels + seed + growth + banks} of them as of `,
      dated(date),
      `: ${angels} angel groups and pitch events, ${seed} for early rounds, ${growth} for growth rounds and ${banks} banks. `,
      "A listing is not a recommendation, so ask other founders about an investor before you pitch.",
    ],
    sections,
  );
}
