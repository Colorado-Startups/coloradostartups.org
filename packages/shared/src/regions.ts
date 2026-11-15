// The three regions with organizers (decision 45). data/regions/<id>.yaml is
// the source; L8 renders /regions/ and /regions/<id>/ from it. City names match
// the spelling in resource.city and company.hq_city, so pages can filter both.

import * as z from "zod";

export const REGION_IDS = ["photon-mountain", "space-peak", "fusion-canyon"] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const RegionSchema = z.object({
  id: z.enum(REGION_IDS),
  name: z.string().min(3).max(40),
  summary: z.string().max(600),
  // The core cities Paul named, then nearby cities that also map here.
  cities: z.array(z.string().min(1).max(60)).min(1),
  nearby: z.array(z.string().min(1).max(60)).default([]),
  // A standing copy rule for this region, when it has one.
  note: z.string().max(200).optional(),
  slack_channel: z.string().max(80).optional(),
  // Art key: a brand v3 place painting such as brand/springs (scripts/brand/pull.mjs).
  art: z.string(),
  order: z.number().int().min(1),
});
export type Region = z.infer<typeof RegionSchema>;

/**
 * A region's one-line lede: the first sentence of its summary. The brand has no
 * taglines (brand decision 46), so cards, the page lede and the meta description
 * read the summary instead.
 */
export function regionLede(region: Pick<Region, "summary">): string {
  return region.summary.trim().split(/(?<=\.)\s/)[0];
}
