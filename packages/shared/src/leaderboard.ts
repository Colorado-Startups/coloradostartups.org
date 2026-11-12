// Leaderboard contracts: a listed company, revenue ranges, editions and nominations.

import * as z from "zod";

import { SlugSchema } from "./resource";

// A company CS lists. Every fact carries a source URL CS gathered itself
// (company site, press). Crunchbase data never enters these records; the
// content gate blocks it in data/leaderboard/**.
export const CompanySchema = z.object({
  id: SlugSchema,
  name: z.string().min(1).max(120),
  website: z.url({ protocol: /^https?$/ }),
  hq_city: z.string().min(1).max(60),
  founded_year: z.number().int().min(1950).max(2100).optional(),
  sector: z.string().min(1).max(60),
  description: z.string().min(1).max(220),
  sources: z.array(z.url()).min(1),
});
export type Company = z.infer<typeof CompanySchema>;

// Public revenue display is a range, never an exact figure.
export const REVENUE_RANGES = [
  "under-1m",
  "1m-5m",
  "5m-20m",
  "20m-100m",
  "over-100m",
] as const;

export const EditionEntrySchema = z.object({
  company: SlugSchema,
  group: z.string().min(1).max(60),
  // Verified editions only. Honoree editions are unranked.
  rank: z.number().int().positive().optional(),
  tier: z.enum(["startup", "growth"]).optional(),
  growth_pct: z.number().optional(),
  revenue_range: z.enum(REVENUE_RANGES).optional(),
});

export const EditionSchema = z
  .object({
    id: SlugSchema,
    title: z.string().min(1).max(120),
    kind: z.enum(["honorees", "verified"]),
    published: z.iso.date(),
    summary: z.string().max(400),
    method: z.string().max(1200),
    entries: z.array(EditionEntrySchema).min(1),
  })
  .refine((e) => e.kind === "verified" || e.entries.every((x) => x.rank === undefined), {
    message: "honoree editions are unranked",
    path: ["entries"],
  });
export type Edition = z.infer<typeof EditionSchema>;

// What the nomination form posts. Revenue is private: it is stored for
// verification and ranking only and never used for investment sourcing.
export const NominationSchema = z.object({
  legal_name: z.string().min(1).max(160),
  website: z.url({ protocol: /^https?$/ }).max(2048),
  // The nominator types the city; the form fills in the county from it when
  // the city sits in one county (#147). Rows stored before 2026-11-02 have
  // hq_county and a `founded` date, and no hq_city or founded_year.
  hq_city: z.string().min(1).max(80),
  hq_county: z.string().min(1).max(60),
  // CompanySchema's bounds, so a nomination's year fits a listed company's.
  founded_year: z.number().int().min(1950).max(2100),
  private_independent_for_profit: z.literal(true),
  base_year: z.number().int().min(2000).max(2100),
  base_year_revenue_usd: z.number().nonnegative(),
  current_year_revenue_usd: z.number().nonnegative(),
  fte_headcount: z.number().int().nonnegative(),
  sector: z.string().min(1).max(60),
  contact_name: z.string().min(1).max(120),
  contact_email: z.email(),
  consent_to_publish: z.literal(true),
  attestation: z.literal(true),
});
export type Nomination = z.infer<typeof NominationSchema>;
