// What a guide page shows in place of its long lists (step F of the redesign,
// 2026-11-15): one chart row per section, each linked to the Startup
// Resources view that holds its records, and five records to start with.
// Pure shaping with no Astro imports; test/unit/guides-browse/ runs it.
//
// A row's link filters Startup Resources by the stage, type and city that
// every one of its records shares, so the linked view always holds all of
// them, and may hold more: the directory filters by those three fields only,
// while a guide also picks by tag. A row whose records share none of the
// three, and is not a region, gets no link. A region row links to its region
// page, which lists the region's resources.
import type { RegionId } from "@cs/shared";

import { writeState, type FilterState } from "../../components/canvas/filter-logic";
import { type Guide, type GuideRecord } from "./core";

export interface GuideRow {
  /** The section's id, or the group's heading when a guide has one section. */
  id: string;
  label: string;
  items: readonly GuideRecord[];
  /** Where the row's link goes: a filtered Startup Resources view, a region page, or nowhere. */
  href: string | null;
}

const DIRECTORY = "/ecosystem-canvas/";

/** The value every record shares for one field, or "" when they differ. */
function shared(items: readonly GuideRecord[], key: "stage" | "type" | "city"): string {
  const values = new Set(items.map((r) => r[key]));
  return values.size === 1 ? [...values][0]! : "";
}

/** The filters every record passes: the stage, type and city they all share. */
export function sharedFilter(items: readonly GuideRecord[]): FilterState {
  return { stage: shared(items, "stage"), type: shared(items, "type"), city: shared(items, "city"), q: "" };
}

/** The Startup Resources view that holds every one of the records, or null when no filter narrows it. */
export function browseHref(items: readonly GuideRecord[]): string | null {
  if (items.length === 0) return null;
  const query = writeState(sharedFilter(items));
  return query ? `${DIRECTORY}${query}` : null;
}

/**
 * The guide's chart rows, in page order: one per section, or one per group
 * when the guide has a single section (the events guide's cities). A region
 * section links its region page.
 */
export function guideRows(guide: Pick<Guide, "sections">, regionIds: readonly RegionId[] = []): GuideRow[] {
  const regions = new Set<string>(regionIds);
  if (guide.sections.length === 1) {
    const [only] = guide.sections;
    return only!.groups.map((g, i) => ({
      id: g.heading ?? `${only!.id}-${i + 1}`,
      label: g.heading ?? only!.heading,
      items: g.items,
      href: browseHref(g.items),
    }));
  }
  return guide.sections.map((s) => {
    const items = s.groups.flatMap((g) => g.items);
    return {
      id: s.id,
      label: s.heading,
      items,
      href: regions.has(s.id) ? `/regions/${s.id}/` : browseHref(items),
    };
  });
}

/** How many records a guide shows in full. */
export const START_WITH = 5;

/**
 * The records a guide shows in full: the first record of each row, A to Z,
 * then the second of each, until there are `n`. One pass across the rows, so
 * every part of the answer gets a record before any gets two; never a ranking.
 */
export function startWith(rows: readonly Pick<GuideRow, "items">[], n = START_WITH): GuideRecord[] {
  const picked: GuideRecord[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...rows.map((r) => r.items.length));
  for (let i = 0; i < longest && picked.length < n; i += 1) {
    for (const row of rows) {
      const r = row.items[i];
      if (!r || seen.has(r.id)) continue;
      picked.push(r);
      seen.add(r.id);
      if (picked.length === n) break;
    }
  }
  return picked;
}
