// Step F (2026-11-15): lib/guides/browse.ts, which turns a guide's lists into
// its chart's rows, each linked to a filtered Startup Resources view, and the
// five records the page shows. On fixtures and on the real data/resources/.
// The built pages are checked in test/dom/l23/.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ResourceSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { matches, readState } from "../../../src/components/canvas/filter-logic";
import { browseHref, guideRows, sharedFilter, START_WITH, startWith } from "../../../src/lib/guides/browse";
import { asOf, buildGuide, GUIDE_SLUGS, guideItems, guideJsonLd, type GuideInput, type GuideRecord } from "../../../src/lib/guides/guides";
import { REGIONS } from "../../../src/lib/regions/match";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/resources");
const SITE = new URL("https://coloradostartups.org");
const records: GuideRecord[] = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => path.join(DATA, d.name, f)))
  .map((file) => ResourceSchema.parse(parse(readFileSync(file, "utf8"))))
  .filter((r) => r.status === "active")
  .map(({ id, name, url, stage, substage, city, type, description, tags }) => ({ id, name, url, stage, substage, city, type, description, tags }))
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
const real: GuideInput = { records, regions: REGIONS, date: asOf(new Date("2026-11-15T18:00:00Z")) };
const regionIds = REGIONS.map((r) => r.id);

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

describe("browseHref", () => {
  it("filters by every field the records share", () => {
    expect(browseHref([rec({ id: "a" }), rec({ id: "b" })])).toBe("/ecosystem-canvas/?stage=launch&type=accelerator&city=Denver");
    expect(browseHref([rec({ id: "a" }), rec({ id: "b", city: "Boulder", type: "incubator" })])).toBe("/ecosystem-canvas/?stage=launch");
  });

  it("gives no link when the records share nothing, or there are none", () => {
    expect(browseHref([rec({ id: "a" }), rec({ id: "b", stage: "idea", type: "event", city: "Boulder" })])).toBeNull();
    expect(browseHref([])).toBeNull();
  });
});

describe("guideRows", () => {
  const two = {
    sections: [
      { id: "photon-mountain", heading: "Photon Mountain", intro: [], groups: [{ items: [rec({ id: "a" }), rec({ id: "b", type: "event" })] }] },
      { id: "statewide", heading: "Statewide", intro: [], groups: [{ heading: "Meetups", items: [rec({ id: "c", city: "statewide" })] }] },
    ],
  };

  it("makes one row per section, in page order, with a region linking its page", () => {
    const rows = guideRows(two, regionIds);
    expect(rows.map((r) => [r.id, r.label, r.items.length, r.href])).toEqual([
      ["photon-mountain", "Photon Mountain", 2, "/regions/photon-mountain/"],
      ["statewide", "Statewide", 1, "/ecosystem-canvas/?stage=launch&type=accelerator&city=statewide"],
    ]);
  });

  it("makes one row per group when the guide has one section", () => {
    const one = { sections: [{ id: "by-city", heading: "By city", intro: [], groups: [
      { heading: "Boulder", items: [rec({ id: "a", city: "Boulder", type: "event" })] },
      { heading: "Denver", items: [rec({ id: "b", type: "event" }), rec({ id: "c", type: "event" })] },
    ] }] };
    expect(guideRows(one).map((r) => [r.label, r.items.length, r.href])).toEqual([
      ["Boulder", 1, "/ecosystem-canvas/?stage=launch&type=event&city=Boulder"],
      ["Denver", 2, "/ecosystem-canvas/?stage=launch&type=event&city=Denver"],
    ]);
  });
});

describe("startWith", () => {
  it("takes the first of each row, then the second, up to five, each once", () => {
    const rows = [
      { items: [rec({ id: "a1" }), rec({ id: "a2" }), rec({ id: "a3" })] },
      { items: [rec({ id: "b1" })] },
      { items: [rec({ id: "c1" }), rec({ id: "a1" }), rec({ id: "c3" })] },
    ];
    expect(startWith(rows).map((r) => r.id)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
    expect(startWith(rows, 2).map((r) => r.id)).toEqual(["a1", "b1"]);
    expect(startWith([]).map((r) => r.id)).toEqual([]);
  });
});

describe.each(GUIDE_SLUGS)("the %s guide on the real data", (slug) => {
  const guide = buildGuide(slug, real);
  const rows = guideRows(guide, regionIds);
  const allowed = {
    stage: new Set(records.map((r) => r.stage)),
    type: new Set(records.map((r) => r.type)),
    city: new Set(records.map((r) => r.city)),
  };
  const view = (href: string) => {
    const state = readState(new URL(href, SITE).search, allowed);
    return new Set(records.filter((r) => matches({ ...r, text: "" }, state, null)).map((r) => r.id));
  };

  it("charts every listed record once, in its row", () => {
    expect(rows.flatMap((r) => r.items.map((i) => i.id))).toEqual(guideItems(guide).map((r) => r.id));
    expect(rows.every((r) => r.items.length > 0)).toBe(true);
  });

  it("links each row to a Startup Resources view that holds every record it counts", () => {
    for (const row of rows) {
      if (!row.href?.startsWith("/ecosystem-canvas/")) continue;
      const shown = view(row.href);
      expect(row.items.filter((r) => !shown.has(r.id)).map((r) => r.id), row.label).toEqual([]);
      expect(readState(new URL(row.href, SITE).search, allowed), row.label).toEqual(sharedFilter(row.items));
    }
  });

  it("shows five records, one from each row first, and lists the same five in its ItemList", () => {
    const start = startWith(rows);
    expect(start).toHaveLength(Math.min(START_WITH, guideItems(guide).length));
    const firsts = rows.slice(0, START_WITH).map((r) => r.items[0]!.id);
    expect(start.slice(0, firsts.length).map((r) => r.id)).toEqual(firsts);
    const ld = guideJsonLd(guide, SITE, start) as { numberOfItems: number; itemListElement: { url: string }[] };
    expect(ld.numberOfItems).toBe(start.length);
    expect(ld.itemListElement.map((e) => e.url)).toEqual(start.map((r) => r.url));
  });
});
