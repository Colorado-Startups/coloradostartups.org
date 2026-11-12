// Team contracts: the AI keepers, the people and the volunteer positions.

import * as z from "zod";

import { COURSE_IDS } from "./apply";

// The Hall's AI keepers, dwarves and gnomes. data/team/dwarves.yaml is the one
// persona source (the file keeps its name for the consumers that read it); L9
// renders it, L4 and L10 read the voice lines for the system prompt and the
// Communitas templates. Each keeper is disclosed as an AI agent wherever it
// appears.
export const DWARF_IDS = ["communitas", "resourcus", "publicus"] as const;

// Decision 43: the keepers are dwarves and gnomes. Resourcus is the gnome.
export const AGENT_KINDS = ["dwarf", "gnome"] as const;

export const DwarfSchema = z.object({
  id: z.enum(DWARF_IDS),
  kind: z.enum(AGENT_KINDS),
  name: z.string(),
  title: z.string(),
  role: z.string().max(200),
  bio: z.string().max(900),
  voice: z.array(z.string().max(200)).min(1).max(8),
  can_help_with: z.array(z.string().max(120)).min(1).max(8),
  surfaces: z.array(z.string().max(80)).min(1),
  disclosure: z.string().min(10).max(200),
  portrait: z.string(),
});
export type Dwarf = z.infer<typeof DwarfSchema>;

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  // "community" holds people who fill an open position (positions.yaml).
  group: z.enum(["leadership", "community", "volunteers", "with-thanks"]),
  bio: z.string().max(900),
  links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
  photo: z.string().optional(),
});
export type Person = z.infer<typeof PersonSchema>;

// Open positions for people (decision 44). Humans fill every moderator and
// organizer seat; the AI keepers never moderate. data/team/positions.yaml is
// the source; /get-involved/, the Team page and region pages render it.
export const POSITION_AREAS = ["community", "region", "project"] as const;
export type PositionArea = (typeof POSITION_AREAS)[number];

export const PositionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(3).max(80),
    area: z.enum(POSITION_AREAS),
    // A region id from data/regions/ when area is "region".
    region: z.string().optional(),
    summary: z.string().min(10).max(300),
    what_you_do: z.array(z.string().max(160)).min(1).max(6),
    status: z.enum(["open", "filled"]),
    // A person id from people.yaml when status is "filled".
    holder: z.string().optional(),
    // Lane L19: a seat that takes applications at /get-involved/apply/?role=<id>,
    // and the Claude Academy courses it requires (REQUIRED_COURSES in apply.ts).
    apply: z.object({ open: z.boolean(), courses: z.array(z.enum(COURSE_IDS)).min(1) }).optional(),
  })
  .refine((p) => (p.status === "filled") === Boolean(p.holder), {
    message: "a filled position names its holder, and an open one names none",
    path: ["holder"],
  })
  .refine((p) => (p.area === "region") === Boolean(p.region), {
    message: "a region position names its region, and no other position does",
    path: ["region"],
  });
export type Position = z.infer<typeof PositionSchema>;

/**
 * The one order for every page that lists positions (/get-involved/,
 * /community/ and /team/): by area (community, region, project, as in
 * POSITION_AREAS), then a region seat by its region's `order` in
 * data/regions/, then by title. Pass the regions (RegionSchema data), so the
 * region order comes from the YAML and not from this file. A seat whose
 * region is not in the list sorts after the known ones.
 *
 *   positions.sort(comparePositions(regions))
 */
export function comparePositions(
  regions: readonly { id: string; order: number }[],
): (a: Position, b: Position) => number {
  const regionOrder = new Map<string, number>(regions.map((r) => [r.id, r.order]));
  const regionRank = (p: Position): number =>
    p.region === undefined ? 0 : (regionOrder.get(p.region) ?? Number.MAX_SAFE_INTEGER);
  return (a, b) =>
    POSITION_AREAS.indexOf(a.area) - POSITION_AREAS.indexOf(b.area) ||
    regionRank(a) - regionRank(b) ||
    a.title.localeCompare(b.title, "en");
}
