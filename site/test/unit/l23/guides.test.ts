// L23: the guide builders in lib/guides/guides.ts, on small fixtures and on
// the real data/resources/. The built pages are checked in test/dom/l23/.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ResourceSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  asOf,
  buildGuide,
  canvasHref,
  GUIDE_SLUGS,
  guideItems,
  guideJsonLd,
  GUIDES,
  GUIDES_INDEX,
  guidesIndexJsonLd,
  mostIn,
  plainText,
  type GuideInput,
  type GuideRecord,
} from "../../../src/lib/guides/guides";
import { REGIONS } from "../../../src/lib/regions/match";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/resources");
const SITE = new URL("https://coloradostartups.org");
const DATE = asOf(new Date("2026-10-18T18:00:00Z"));

const records: GuideRecord[] = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => path.join(DATA, d.name, f)))
  .map((file) => ResourceSchema.parse(parse(readFileSync(file, "utf8"))))
  .filter((r) => r.status === "active")
  .map(({ id, name, url, stage, substage, city, type, description, tags }) => ({
    id,
    name,
    url,
    stage,
    substage,
    city,
    type,
    description,
    tags,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
const real: GuideInput = { records, regions: REGIONS, date: DATE };

const rec = (over: Partial<GuideRecord> & Pick<GuideRecord, "id">): GuideRecord => ({
  name: over.id,
  url: `https://example.org/${over.id}`,
  stage: "launch",
  substage: "develop",
  city: "Denver",
  type: "accelerator",
  description: "A fixture.",
  tags: [],
  ...over,
});

// One sentence ends at ". ", "! " or "? ", or at the end of the text.
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== "");

describe("asOf", () => {
  it("dates the build in Denver, so a late-evening build keeps its own day", () => {
    expect(asOf(new Date("2026-10-19T04:30:00Z"))).toEqual({ label: "October 18, 2026", iso: "2026-10-18" });
    expect(asOf(new Date("2026-10-19T07:30:00Z"))).toEqual({ label: "October 19, 2026", iso: "2026-10-19" });
  });
});

describe("mostIn", () => {
  it("names the two busiest cities when they hold more than half", () => {
    const items = [
      rec({ id: "a", city: "Boulder" }),
      rec({ id: "b", city: "Boulder" }),
      rec({ id: "c", city: "Denver" }),
      rec({ id: "d", city: "Greeley" }),
    ];
    expect(mostIn(items)).toBe("most of them in Boulder and Denver");
  });

  it("says all when the two cities hold every item, and nothing when they hold half or less", () => {
    expect(mostIn([rec({ id: "a", city: "Denver" })])).toBe("all of them in Denver");
    const spread = ["Boulder", "Denver", "Greeley", "Loveland"].map((city) => rec({ id: city, city }));
    expect(mostIn(spread)).toBeUndefined();
  });

  it("never counts statewide or online as a city", () => {
    const items = [rec({ id: "a", city: "statewide" }), rec({ id: "b", city: "online" }), rec({ id: "c" })];
    expect(mostIn(items)).toBeUndefined();
  });
});

describe.each(GUIDE_SLUGS)("the %s guide on the real data", (slug) => {
  const guide = buildGuide(slug, real);
  const items = guideItems(guide);
  const answer = plainText(guide.answer);

  it("answers in two or three sentences, with a count, its source and the date", () => {
    expect(sentences(answer).length).toBeGreaterThanOrEqual(2);
    expect(sentences(answer).length).toBeLessThanOrEqual(3);
    const counted = sentences(answer).find((s) => /\d/.test(s.replace(DATE.label, "")));
    expect(counted).toMatch(/Startup Resources/);
    expect(counted).toContain(`as of ${DATE.label}`);
  });

  it("keeps every sentence to 30 words, with no dashes", () => {
    for (const s of sentences(answer)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(30);
    expect(answer).not.toMatch(/—|\s–\s/);
  });

  it("lists only active records, each once, and no empty section", () => {
    expect(items.length).toBeGreaterThan(0);
    const active = new Set(records.map((r) => r.id));
    expect(items.every((r) => active.has(r.id))).toBe(true);
    expect(new Set(items.map((r) => r.id)).size).toBe(items.length);
    for (const s of guide.sections) expect(guideItems({ sections: [s] }).length, s.id).toBeGreaterThan(0);
  });

  it("gives every section a unique anchor", () => {
    const ids = guide.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds an ItemList of every listed record, in page order", () => {
    const ld = guideJsonLd(guide, SITE) as { itemListElement: { position: number; name: string; url: string }[] };
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: GUIDES[slug].title,
      url: `https://coloradostartups.org/guides/${slug}/`,
      numberOfItems: items.length,
    });
    expect(ld.itemListElement.map((e) => e.url)).toEqual(items.map((r) => r.url));
    expect(ld.itemListElement.map((e) => e.position)).toEqual(items.map((_, i) => i + 1));
  });
});

describe("what each guide selects", () => {
  const ids = (slug: (typeof GUIDE_SLUGS)[number]) => new Set(guideItems(buildGuide(slug, real)).map((r) => r.id));

  it("lists every active accelerator and incubator, and nothing else, on the accelerators guide", () => {
    const want = records.filter((r) => r.type === "accelerator" || r.type === "incubator").map((r) => r.id);
    expect([...ids("colorado-accelerators-and-incubators")].sort()).toEqual(want.sort());
  });

  it("lists every meetup, event and coworking space once on the where-founders-meet guide", () => {
    const want = records.filter((r) => ["community", "event", "coworking"].includes(r.type)).map((r) => r.id);
    expect([...ids("where-founders-meet")].sort()).toEqual(want.sort());
  });

  it("lists every record in the investors substage on the funding guide", () => {
    const got = ids("funding-programs");
    for (const r of records.filter((r) => r.substage === "investors")) expect(got.has(r.id), r.id).toBe(true);
  });

  it("starts a company with a link to the Secretary of State and lists legal help", () => {
    const guide = buildGuide("start-a-company-in-colorado", real);
    expect(guide.answer).toContainEqual({ text: "Colorado Secretary of State", href: "https://www.coloradosos.gov/" });
    expect(guide.sections.map((s) => s.id)).toEqual(["learn", "test", "local-help", "advisers"]);
  });
});

// #236: the two long lists split under h3s, each record in one group.
describe("the start-a-company guide's groups", () => {
  const TEST_GROUPS = ["Meetups and communities", "Events, pitch nights and hackathons", "Coworking spaces", "Other resources"];
  const LAWYER_GROUPS = ["Lawyers in Denver", "Lawyers in Boulder", "Lawyers in other Colorado towns", "Lawyers statewide and online"];
  const ADVISER_GROUPS = [...LAWYER_GROUPS, "Accountants", "Banks"];
  const section = (guide: ReturnType<typeof buildGuide>, id: string) => guide.sections.find((s) => s.id === id)!;
  const headings = (s: { groups: { heading?: string }[] }) => s.groups.map((g) => g.heading);
  const groupIds = (s: { groups: { heading?: string; items: GuideRecord[] }[] }) =>
    Object.fromEntries(s.groups.map((g) => [g.heading ?? "", g.items.map((r) => r.id)]));
  /** True when `got` keeps the order of `all`, skipping any it lacks. */
  const inOrder = (got: readonly (string | undefined)[], all: readonly string[]) =>
    got.every((h, i) => h !== undefined && all.indexOf(h) > (i === 0 ? -1 : all.indexOf(got[i - 1]!)));

  it("inOrder self-test: passes a subsequence and fails a swap, a stranger or a missing heading", () => {
    expect(inOrder(["Lawyers in Denver", "Banks"], ADVISER_GROUPS)).toBe(true);
    expect(inOrder(["Banks", "Lawyers in Denver"], ADVISER_GROUPS)).toBe(false);
    expect(inOrder(["Lawyers in Denver", "Brokers"], ADVISER_GROUPS)).toBe(false);
    expect(inOrder([undefined], ADVISER_GROUPS)).toBe(false);
  });

  it("files fixture records by type and by tag, in group order, each in the first group it matches", () => {
    const input: GuideInput = {
      regions: REGIONS,
      date: DATE,
      records: [
        rec({ id: "a-bank", type: "service-provider", tags: ["banking"] }),
        rec({ id: "b-books", type: "service-provider", tags: ["accounting"] }),
        rec({ id: "c-class", type: "education", tags: ["entrepreneurship"] }),
        rec({ id: "d-cowork", type: "coworking", stage: "idea", substage: "validate" }),
        rec({ id: "e-firm", type: "service-provider", tags: ["accounting", "legal"], city: "Boulder" }),
        rec({ id: "f-hackathon", type: "event", stage: "idea", substage: "validate" }),
        rec({ id: "g-law", type: "service-provider", tags: ["legal"] }),
        rec({ id: "h-meetup", type: "community", stage: "idea", substage: "validate" }),
        rec({ id: "i-nonprofit", type: "nonprofit", stage: "idea", substage: "validate" }),
        rec({ id: "j-office", type: "government" }),
        rec({ id: "k-law", type: "service-provider", tags: ["legal"], city: "Golden" }),
        rec({ id: "l-law", type: "service-provider", tags: ["legal"], city: "statewide" }),
      ],
    };
    const guide = buildGuide("start-a-company-in-colorado", input);
    expect(groupIds(section(guide, "test"))).toEqual({
      "Meetups and communities": ["h-meetup"],
      "Events, pitch nights and hackathons": ["f-hackathon"],
      "Coworking spaces": ["d-cowork"],
      "Other resources": ["i-nonprofit"],
    });
    expect(groupIds(section(guide, "advisers"))).toEqual({
      "Lawyers in Denver": ["g-law"],
      "Lawyers in Boulder": ["e-firm"],
      "Lawyers in other Colorado towns": ["k-law"],
      "Lawyers statewide and online": ["l-law"],
      Accountants: ["b-books"],
      Banks: ["a-bank"],
    });
    // The two short sections keep one list with no h3.
    expect(headings(section(guide, "learn"))).toEqual([undefined]);
    expect(headings(section(guide, "local-help"))).toEqual([undefined]);
    // Every fixture record shows once.
    expect(guideItems(guide).map((r) => r.id).sort()).toEqual(input.records.map((r) => r.id).sort());
  });

  it("drops a group that has no records, keeping the rest in order", () => {
    const guide = buildGuide("start-a-company-in-colorado", {
      regions: REGIONS,
      date: DATE,
      records: [
        rec({ id: "a-meetup", type: "community", stage: "idea", substage: "validate" }),
        rec({ id: "b-law", type: "service-provider", tags: ["legal"] }),
        rec({ id: "c-bank", type: "service-provider", tags: ["banking"] }),
      ],
    });
    expect(headings(section(guide, "test"))).toEqual(["Meetups and communities"]);
    expect(headings(section(guide, "advisers"))).toEqual(["Lawyers in Denver", "Banks"]);
  });

  describe("on the real data", () => {
    const guide = buildGuide("start-a-company-in-colorado", real);
    const test = section(guide, "test");
    const advisers = section(guide, "advisers");
    const listed = new Set(guideItems(guide).map((r) => r.id));
    const tagged = (r: GuideRecord, tag: string) => r.tags.includes(tag);

    it("splits both long lists under headings in group order, with no empty group", () => {
      expect(test.groups.length).toBeGreaterThan(1);
      expect(advisers.groups.length).toBeGreaterThan(1);
      expect(inOrder(headings(test), TEST_GROUPS), headings(test).join(", ")).toBe(true);
      expect(inOrder(headings(advisers), ADVISER_GROUPS), headings(advisers).join(", ")).toBe(true);
      for (const g of [...test.groups, ...advisers.groups]) expect(g.items.length, g.heading).toBeGreaterThan(0);
    });

    it("drops no record the sections pick: every idea-stage validator and every lawyer, accountant and bank", () => {
      const want = records.filter(
        (r) =>
          (r.stage === "idea" && r.substage === "validate") ||
          (r.type === "service-provider" && ["legal", "accounting", "banking"].some((t) => tagged(r, t))),
      );
      expect(want.length).toBeGreaterThan(0);
      expect(want.filter((r) => !listed.has(r.id)).map((r) => r.id)).toEqual([]);
    });

    it("puts each record under the heading that names it", () => {
      const byType: Record<string, string> = {
        "Meetups and communities": "community",
        "Events, pitch nights and hackathons": "event",
        "Coworking spaces": "coworking",
      };
      for (const g of test.groups) {
        const type = byType[g.heading!];
        for (const r of g.items) {
          if (type) expect(r.type, r.id).toBe(type);
          else expect(Object.values(byType), r.id).not.toContain(r.type);
        }
      }
      const lawyer = (r: GuideRecord) => tagged(r, "legal");
      const anywhere = (r: GuideRecord) => r.city === "statewide" || r.city === "online";
      const rule: Record<string, (r: GuideRecord) => boolean> = {
        "Lawyers in Denver": (r) => lawyer(r) && r.city === "Denver",
        "Lawyers in Boulder": (r) => lawyer(r) && r.city === "Boulder",
        "Lawyers in other Colorado towns": (r) => lawyer(r) && !["Denver", "Boulder"].includes(r.city) && !anywhere(r),
        "Lawyers statewide and online": (r) => lawyer(r) && anywhere(r),
        Accountants: (r) => !tagged(r, "legal") && tagged(r, "accounting"),
        Banks: (r) => !tagged(r, "legal") && !tagged(r, "accounting") && tagged(r, "banking"),
      };
      for (const g of advisers.groups) for (const r of g.items) expect(rule[g.heading!]!(r), `${g.heading}: ${r.id}`).toBe(true);
    });

    // #723: one list of lawyers ran about 7,800 px on a phone.
    it("splits the lawyers by place, with no place holding half of them", () => {
      const lawyers = advisers.groups.filter((g) => g.heading?.startsWith("Lawyers"));
      const total = lawyers.reduce((n, g) => n + g.items.length, 0);
      expect(lawyers.length).toBeGreaterThan(1);
      for (const g of lawyers) expect(g.items.length, g.heading).toBeLessThan(total / 2);
    });

    it("keeps each group A to Z, as the records arrive", () => {
      for (const g of [...test.groups, ...advisers.groups]) {
        const names = g.items.map((r) => r.name);
        expect(names, g.heading).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
      }
    });
  });
});

describe("the where-founders-meet guide", () => {
  const guide = buildGuide("where-founders-meet", real);

  it("has one section per region, in order, each linking its region page", () => {
    const regionSections = guide.sections.slice(0, REGIONS.length);
    expect(regionSections.map((s) => s.id)).toEqual(REGIONS.map((r) => r.id));
    for (const s of regionSections) expect(s.intro).toContainEqual(expect.objectContaining({ href: `/regions/${s.id}/` }));
  });

  it("names every region in its meta description", () => {
    for (const r of REGIONS) expect(GUIDES["where-founders-meet"].description).toContain(r.name);
  });

  it("files a fixture record by its city's region, statewide, or elsewhere", () => {
    const input: GuideInput = {
      regions: REGIONS,
      date: DATE,
      records: [
        rec({ id: "boulder-meetup", type: "community", city: "Boulder" }),
        rec({ id: "springs-cowork", type: "coworking", city: "Colorado Springs" }),
        rec({ id: "online-group", type: "community", city: "online" }),
        rec({ id: "durango-event", type: "event", city: "Durango" }),
        rec({ id: "an-accelerator", type: "accelerator", city: "Boulder" }),
      ],
    };
    const where = Object.fromEntries(
      buildGuide("where-founders-meet", input).sections.map((s) => [s.id, guideItems({ sections: [s] }).map((r) => r.id)]),
    );
    expect(where).toEqual({
      "photon-mountain": ["boulder-meetup"],
      "space-peak": ["springs-cowork"],
      statewide: ["online-group"],
      elsewhere: ["durango-event"],
    });
  });
});

describe("the funding guide (hard constraints 2 and 8)", () => {
  const guide = buildGuide("funding-programs", real);
  const words = [plainText(guide.answer), ...guide.sections.flatMap((s) => [s.heading, plainText(s.intro)])].join(" ");

  it("never mentions a Colorado Startups fund, the Leaderboard or a ranking", () => {
    expect(words).not.toMatch(/colorado startups/i);
    expect(words).not.toMatch(/leaderboard|rank/i);
    expect(JSON.stringify(guide)).not.toContain("/leaderboard");
  });

  it("names no investor in its own words; names appear only in the list", () => {
    expect(words).not.toMatch(/\binvestors?\s+(?:include|including|are)\b|\bbacked\s+by\b|\bled\s+by\b/i);
  });

  it("calls the list unordered, so no reader takes it for a ranking", () => {
    expect(guideJsonLd(guide, SITE)).toMatchObject({ itemListOrder: "https://schema.org/ItemListUnordered" });
  });
});

describe("helpers", () => {
  it("links a record to its directory anchor", () => {
    expect(canvasHref("techstars-boulder-accelerator")).toBe("/ecosystem-canvas/#r-techstars-boulder-accelerator");
  });

  it("builds the index ItemList from the guides, with absolute URLs", () => {
    const guides = GUIDE_SLUGS.map((slug) => buildGuide(slug, real));
    const ld = guidesIndexJsonLd(guides, SITE) as { itemListElement: { url: string }[]; url: string };
    expect(ld.url).toBe(`https://coloradostartups.org${GUIDES_INDEX.path}`);
    expect(ld.itemListElement.map((e) => e.url)).toEqual(
      GUIDE_SLUGS.map((slug) => `https://coloradostartups.org/guides/${slug}/`),
    );
  });

  it("gives every guide a unique title and description", () => {
    const metas = [...Object.values(GUIDES), GUIDES_INDEX];
    expect(new Set(metas.map((m) => m.title)).size).toBe(metas.length);
    expect(new Set(metas.map((m) => m.description)).size).toBe(metas.length);
  });
});
