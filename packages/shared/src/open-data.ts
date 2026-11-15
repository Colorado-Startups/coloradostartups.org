// Open data under /data/: the files the site build writes beside
// resources.json, and the record shapes the /mcp Worker reads back through
// the ASSETS binding. Each record carries its region, worked out at build
// time by the site's own regionForCity (site/src/lib/regions/match.ts), so
// the Worker never repeats the city rules.

import * as z from "zod";

import { CompanySchema } from "./leaderboard";
import { REGION_IDS } from "./regions";
import { SlugSchema } from "./resource";

export const COMPANIES_JSON_PATH = "/data/companies.json";
export const EVENTS_JSON_PATH = "/data/events.json";
export const GUIDES_JSON_PATH = "/data/guides.json";
export const REGIONS_JSON_PATH = "/data/regions.json";

// A region id, or "elsewhere" for a place no region lists (statewide, online,
// or a city outside the three).
export const PlaceRegionSchema = z.enum([...REGION_IDS, "elsewhere"]);
export type PlaceRegion = z.infer<typeof PlaceRegionSchema>;

// One Leaderboard honoree: its public company record, the boards it is on,
// and its region.
export const OpenCompanySchema = CompanySchema.extend({
  groups: z.array(z.string()),
  region: PlaceRegionSchema,
});
export type OpenCompany = z.infer<typeof OpenCompanySchema>;

// One event on the calendar that had not ended when the site was built.
export const OpenEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  inPerson: z.boolean(),
  region: PlaceRegionSchema,
});
export type OpenEvent = z.infer<typeof OpenEventSchema>;

// One guide page: its path, title, description and the answer in plain text.
export const OpenGuideSchema = z.object({
  id: SlugSchema,
  title: z.string(),
  description: z.string(),
  url: z.string(),
  answer: z.string(),
  region: PlaceRegionSchema,
});
export type OpenGuide = z.infer<typeof OpenGuideSchema>;

// One region: its page and the cities that map to it.
export const OpenRegionSchema = z.object({
  id: z.enum(REGION_IDS),
  name: z.string(),
  summary: z.string(),
  url: z.string(),
  cities: z.array(z.string()),
  nearby: z.array(z.string()),
  // Ids of the active Startup Resources listings whose city maps here.
  resources: z.array(SlugSchema),
});
export type OpenRegion = z.infer<typeof OpenRegionSchema>;
