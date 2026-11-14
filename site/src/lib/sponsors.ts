// /sponsors/: the GitHub Sponsors rewards (Paul, 2026-11-13). Pure shaping with
// no Astro imports: the page passes in data/sponsors/sponsors.yaml as text,
// and test/unit/sponsors/ runs every function in plain Node. A bad row throws,
// so the build stops before a reward ships wrong.
import { parse } from "yaml";
import { z } from "zod";

export const SPONSORS_URL = "https://github.com/sponsors/Colorado-Startups";

/** Highest first: the order /sponsors/ lists names in. */
export const TIERS = [
  "peak-partner",
  "summit-sponsor",
  "one-time-100",
  "basecamp-backer",
  "one-time-25",
  "trail-supporter",
] as const;
/** The tiers whose reward is a name and link in README.md. */
export const README_TIERS: readonly Tier[] = ["peak-partner", "summit-sponsor", "one-time-100"];
export type Tier = (typeof TIERS)[number];

const SponsorSchema = z
  .object({
    name: z.string().min(1).max(80),
    url: z.string().regex(/^https:\/\/[^/\s]+\S*$/),
    tier: z.enum(TIERS),
    logo: z.string().regex(/^\/sponsor-logos\/[a-z0-9-]+\.(svg|png|webp)$/).optional(),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((s) => (s.tier === "peak-partner") === Boolean(s.logo), {
    message: "a peak-partner row names its logo, and no other row does",
    path: ["logo"],
  });
export type Sponsor = z.infer<typeof SponsorSchema>;

/** The file, parsed. An empty file is no sponsors; a bad row or a repeated name throws. */
export function parseSponsors(text: string): Sponsor[] {
  const rows = z.array(SponsorSchema).parse(parse(text) ?? []);
  if (new Set(rows.map((s) => s.name)).size !== rows.length) throw new Error("sponsors.yaml repeats a name");
  return rows;
}

/** Whether a row shows on `today`: a one-time sponsor shows for a year from `since`. */
export function isCurrent(s: Sponsor, today: string): boolean {
  if (!s.tier.startsWith("one-time")) return true;
  const end = new Date(`${s.since}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return today < end.toISOString().slice(0, 10);
}

/** The names list: current rows, highest tier first, then the longest-standing. */
export function shownSponsors(rows: readonly Sponsor[], today: string): Sponsor[] {
  return rows
    .filter((s) => isCurrent(s, today))
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.since.localeCompare(b.since));
}
