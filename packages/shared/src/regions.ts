// The three regions with organizers (decision 45). data/regions/<id>.yaml is
// the source; L8 renders /regions/ and /regions/<id>/ from it. City names match
// the spelling in resource.city and company.hq_city, so pages can filter both.

import * as z from "zod";

export const REGION_IDS = ["photon-mountain", "space-peak", "fusion-canyon"] as const;
export type RegionId = (typeof REGION_IDS)[number];

// A hotspot on the region's painting (step W3a). x and y are percentages of the
// painting's width and height, from its top left corner. The label says what
// opens, in 4 words or fewer. A place hotspot names the real landmark painted
// there, and its label is that name only. W3b draws them; spacing and the edge
// margin are checked against the data in test/unit/l8/hotspots.test.ts.
export const HOTSPOT_KINDS = ["companies", "event", "resources", "seat", "place"] as const;
export type HotspotKind = (typeof HOTSPOT_KINDS)[number];
export const HOTSPOT_MAX_WORDS = 4;

export const HotspotSchema = z
  .strictObject({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    label: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((s) => s.trim().split(/\s+/).length <= HOTSPOT_MAX_WORDS, {
        message: `a hotspot label has at most ${HOTSPOT_MAX_WORDS} words`,
      }),
    kind: z.enum(HOTSPOT_KINDS),
    landmark: z.string().min(2).max(60).optional(),
  })
  .refine((h) => (h.kind === "place") === Boolean(h.landmark), {
    message: "a place hotspot names its landmark, and only a place hotspot does",
  })
  .refine((h) => h.kind !== "place" || h.label === h.landmark, {
    message: "a place hotspot's label is the landmark's name only",
  });
export type Hotspot = z.infer<typeof HotspotSchema>;

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
  // Points on the painting that open real content (W3a data, W3b UI).
  hotspots: z.array(HotspotSchema).max(6).optional(),
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
