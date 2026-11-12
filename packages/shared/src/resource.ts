// Resource contracts: Canvas stages, resource types, the record, its card and filters.

import * as z from "zod";

// The Ecosystem Canvas journey. Stages and substages come from the current
// Canvas Google Doc (sections Idea, Launch, Growth, Additional Support).
export const STAGES = ["idea", "launch", "growth", "support"] as const;
export type Stage = (typeof STAGES)[number];

export const SUBSTAGES: Record<Stage, readonly string[]> = {
  idea: ["educate", "validate"],
  launch: ["develop", "investors", "service-providers"],
  growth: ["investors", "service-providers"],
  support: ["evangelists", "organizations"],
};

export const RESOURCE_TYPES = [
  "accelerator",
  "incubator",
  "coworking",
  "education",
  "event",
  "community",
  "investor",
  "service-provider",
  "government",
  "university",
  "nonprofit",
  "media",
  "tool",
  "other",
] as const;

// Lowercase kebab-case id; it is also the file name in data/resources/<stage>/.
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase kebab-case")
  .max(80);

export const ResourceSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1).max(120),
    url: z.url({ protocol: /^https?$/ }),
    stage: z.enum(STAGES),
    substage: z.string(),
    // One Colorado city, "statewide" or "online".
    city: z.string().min(1).max(60),
    type: z.enum(RESOURCE_TYPES),
    // One line written by CS. The content gate blocks URLs and imperatives here,
    // because this text reaches the model as retrieved context.
    description: z.string().min(1).max(220),
    tags: z.array(z.string().max(40)).max(8).default([]),
    source: z.enum(["canvas-2026", "suggestion", "cs"]),
    status: z.enum(["active", "review", "dead"]).default("active"),
    last_checked: z.iso.date().optional(),
    // The day CS added the record, quoted like last_checked. The feed dates a
    // resource by it, because last_checked moves on every link check. A record
    // without it stays out of /feed.json and /rss.xml. Optional and additive.
    added: z.iso.date().optional(),
  })
  .refine((r) => SUBSTAGES[r.stage].includes(r.substage), {
    message: "substage must belong to stage",
    path: ["substage"],
  });
export type Resource = z.infer<typeof ResourceSchema>;

// The public card shape the UI and Slack render. Built from our own data, never
// from model output, so a model cannot invent a link.
export const ResourceCardSchema = z.object({
  id: SlugSchema,
  name: z.string(),
  url: z.string(),
  stage: z.enum(STAGES),
  substage: z.string(),
  city: z.string(),
  type: z.enum(RESOURCE_TYPES),
  description: z.string(),
});
export type ResourceCard = z.infer<typeof ResourceCardSchema>;

// The public card for a resource: only the fields the UI and Slack render, so
// a new private field on Resource never reaches a card.
export function toCard(r: Resource): ResourceCard {
  const { id, name, url, stage, substage, city, type, description } = r;
  return { id, name, url, stage, substage, city, type, description };
}

// Filters a visitor or Slack user can apply to a question.
export const ResourceFiltersSchema = z
  .object({
    stage: z.enum(STAGES).optional(),
    city: z.string().max(60).optional(),
    type: z.enum(RESOURCE_TYPES).optional(),
  })
  .strict();
export type ResourceFilters = z.infer<typeof ResourceFiltersSchema>;

// Public path of the build-time card list. L3 generates it; the Worker reads it
// through the ASSETS binding as its only card source.
export const RESOURCES_JSON_PATH = "/data/resources.json";
