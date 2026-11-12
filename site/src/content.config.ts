// Every content collection, in one place. Orchestrator-owned: lanes write the
// data files, not this config. Schemas come from @cs/shared so the build, the
// Worker and the Communitas Worker validate the same shapes.
//
// Layout of data/ (repo root), one owner per folder. These are collections:
//   resources/<stage>/<id>.yaml      L3  one resource per file
//   leaderboard/companies/<id>.yaml  L2  one company per file
//   leaderboard/editions/<id>.yaml   L2  one edition per file
//   team/dwarves.yaml                L10 (copy; L4, L5 and L9 read it)
//   team/people.yaml                 L9
//   team/positions.yaml              L9  open positions for people
//   communitas/routes.yaml           L5  welcome desk routes
//   communitas/threads.yaml          L5  approved Slack thread openers
//   dispatches/*.md                  L1  Publicus's public log
//   legal/*.md                       L6  privacy policy and other legal pages
//
// These are read directly, not as collections:
//   regions/<id>.yaml                lib/regions/match.ts (REGIONS, validated with RegionSchema)
//   leaderboard/notes.yaml           lib/leaderboard/notes.ts
//   positions/*.yaml                 lib/seats/load.ts; scripts/positions/sync-volunteers.mjs writes them
//   events/upcoming.json             components/events/events.ts; scripts/events/fetch-ics.mjs writes it
//   credits/startup-programs.json    lib/guides/credits.ts
//   communitas/slack.yaml            workers/communitas/scripts/library.mjs

import {
  CompanySchema,
  DwarfSchema,
  EditionSchema,
  PersonSchema,
  PositionSchema,
  ResourceSchema,
  ThreadOpenerSchema,
  WelcomeRouteSchema,
} from "@cs/shared";
import { defineCollection } from "astro:content";
import { file, glob } from "astro/loaders";
import { z } from "astro/zod";

const DATA = "../data";

const resources = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: `${DATA}/resources` }),
  schema: ResourceSchema,
});

const companies = defineCollection({
  loader: glob({ pattern: "*.yaml", base: `${DATA}/leaderboard/companies` }),
  schema: CompanySchema,
});

const editions = defineCollection({
  loader: glob({ pattern: "*.yaml", base: `${DATA}/leaderboard/editions` }),
  schema: EditionSchema,
});

const dwarves = defineCollection({
  loader: file(`${DATA}/team/dwarves.yaml`),
  schema: DwarfSchema,
});

const people = defineCollection({
  loader: file(`${DATA}/team/people.yaml`),
  schema: PersonSchema,
});

const positions = defineCollection({
  loader: file(`${DATA}/team/positions.yaml`),
  schema: PositionSchema,
});

const welcomeRoutes = defineCollection({
  loader: file(`${DATA}/communitas/routes.yaml`),
  schema: WelcomeRouteSchema,
});

// Validation only: no page reads threads.yaml. The build checks it against
// ThreadOpenerSchema here, and the Communitas Worker validates and posts it.
const threads = defineCollection({
  loader: file(`${DATA}/communitas/threads.yaml`),
  schema: ThreadOpenerSchema,
});

const dispatches = defineCollection({
  loader: glob({ pattern: "*.md", base: `${DATA}/dispatches` }),
  schema: z.object({
    title: z.string().max(120),
    date: z.coerce.date(),
    summary: z.string().max(300),
    tags: z.array(z.string()).default([]),
  }),
});

const legal = defineCollection({
  loader: glob({ pattern: "*.md", base: `${DATA}/legal` }),
  schema: z.object({
    title: z.string(),
    updated: z.coerce.date(),
    summary: z.string().max(300),
    // Paul approves each policy at Gate B. Until a file says "approved", its
    // page shows a draft notice (L13, decision on PR #23).
    status: z.enum(["draft", "approved"]).default("draft"),
  }),
});

export const collections = {
  resources,
  companies,
  editions,
  dwarves,
  people,
  positions,
  welcomeRoutes,
  threads,
  dispatches,
  legal,
};
