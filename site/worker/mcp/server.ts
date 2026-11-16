// The /mcp server: keyless, read-only and stateless. Each request gets a
// fresh McpServer from createMcpHandler, which serves the 2026-07-28 protocol
// and, for older clients, the stateless 2025 Streamable HTTP fallback. Seven
// tools, each read-only and capped at 25 results (tools.ts), and two prompts
// that tell the model which of those tools to call, in order.
import { REGION_IDS, SlugSchema, STAGES } from "@cs/shared";
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import * as z from "zod";

import type { OpenData } from "./data";
import {
  company,
  events,
  guide,
  guideSlugs,
  MAX_RESULTS,
  path,
  PATH_STEPS,
  region,
  search,
  SEARCH_TYPES,
  thisWeek,
  WEEK_EVENTS,
} from "./tools";

export const SERVER_NAME = "coloradostartups";

export const INSTRUCTIONS = [
  "Colorado Startups (coloradostartups.org) is a community of entrepreneurs building companies in Colorado.",
  "This server is read-only and needs no key.",
  "It searches the site's open data: Startup Resources (programs, investors, coworking and services for founders), the Leaderboard's honoree companies, the guides for founders, and the event calendar.",
  "The community has three regions: Photon Mountain (Boulder, Golden, Arvada and Denver), Space Peak (Colorado Springs and Fountain) and Fusion Canyon (Fort Collins, Loveland and Windsor).",
  `For a founder asking where to start, path gives up to ${PATH_STEPS} Startup Resources for their stage, each with one line on why it fits.`,
  "For one Leaderboard honoree, company gives its public record by id; search finds the id.",
  "For one founder guide, guide gives its full answer by slug; search with type guide finds the slug.",
  `For the week ahead, this_week gives up to ${WEEK_EVENTS} events in the next 7 days, Mountain Time.`,
  "Two prompts, Plan my founder week and Find my first resources, set out which tools to call and in what order.",
  `Each tool returns at most ${MAX_RESULTS} results, each with a link to its page on the site.`,
  "The data is free under CC BY 4.0: credit Colorado Startups and link https://coloradostartups.org/data/.",
  "Listings change, so tell people to check each organization's own site.",
].join(" ");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const RegionArg = z.enum(REGION_IDS).describe("photon-mountain, space-peak or fusion-canyon");
const DayArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("A day as YYYY-MM-DD, Mountain Time");

const StageArg = z.enum(STAGES).describe("idea, launch, growth or support");

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/** One server instance over the open data, linking to `origin`. */
export function buildServer(data: OpenData, origin: string, now: () => Date = () => new Date()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, title: "Colorado Startups", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search",
    {
      title: "Search Colorado Startups",
      description: `Search Startup Resources, Leaderboard companies and guides by words. Filter by type and region. Up to ${MAX_RESULTS} results, best first.`,
      inputSchema: z.object({
        words: z.string().min(1).max(200).describe("What to look for, such as 'accelerator Boulder' or 'space'"),
        type: z.enum(SEARCH_TYPES).optional().describe("resource, company or guide; all three when left out"),
        region: RegionArg.optional(),
      }),
      annotations: READ_ONLY,
    },
    async (input) => result(search(data, input, origin)),
  );

  server.registerTool(
    "events",
    {
      title: "Upcoming Colorado startup events",
      description: `Events on the Colorado Startups calendar between two days, soonest first. Up to ${MAX_RESULTS}.`,
      inputSchema: z.object({
        from: DayArg.optional().describe("First day, YYYY-MM-DD in Mountain Time; today when left out"),
        to: DayArg.optional().describe("Last day, YYYY-MM-DD in Mountain Time"),
        region: RegionArg.optional(),
      }),
      annotations: READ_ONLY,
    },
    async (input) => result(events(data, input, now())),
  );

  server.registerTool(
    "region",
    {
      title: "A Colorado Startups region",
      description:
        "One region: its summary, cities and counts, with up to 10 resources, 10 companies and 5 upcoming events.",
      inputSchema: z.object({ id: RegionArg }),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const r = region(data, id, origin, now());
      return r ? result(r) : { ...result({ error: `No data for region ${id}` }), isError: true };
    },
  );

  server.registerTool(
    "path",
    {
      title: "A founder's next steps",
      description: `A short path for a founder at one stage: up to ${PATH_STEPS} Startup Resources, in the order of the stage's steps, each with one line on why it fits. Add what they need and their region to narrow it.`,
      inputSchema: z.object({
        stage: StageArg,
        need: z.string().min(1).max(200).optional().describe("What the founder needs now, such as 'first customers' or 'hardware'"),
        region: RegionArg.optional(),
      }),
      annotations: READ_ONLY,
    },
    async (input) => result(path(data, input, origin)),
  );

  server.registerTool(
    "company",
    {
      title: "A Leaderboard company",
      description:
        "One Leaderboard honoree's public record: what it does, sector, city, region, boards, website and sources. Find the id with search.",
      inputSchema: z.object({ id: SlugSchema.describe("The company id, such as 'acme-robotics'") }),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const c = company(data, id, origin);
      return c
        ? result(c)
        : { ...result({ error: `No Leaderboard company with id ${id}. Use search with type company to find one.` }), isError: true };
    },
  );

  server.registerTool(
    "guide",
    {
      title: "A founder guide",
      description:
        "One founder guide from coloradostartups.org/guides/: its title, summary and full answer, with a link. Find the slug with search, type guide.",
      inputSchema: z.object({ slug: SlugSchema.describe("The guide slug, such as 'startup-credits'") }),
      annotations: READ_ONLY,
    },
    async ({ slug }) => {
      const g = guide(data, slug, origin);
      if (g) return result(g);
      const { slugs, more } = guideSlugs(data);
      const valid = slugs.length > 0 ? `Valid slugs: ${slugs.join(", ")}${more > 0 ? `, and ${more} more` : ""}.` : "No guides are published yet.";
      return { ...result({ error: `No guide with that slug. ${valid}`, slugs }), isError: true };
    },
  );

  server.registerTool(
    "this_week",
    {
      title: "This week for Colorado founders",
      description: `The events in the next 7 days, today included, in Mountain Time: up to ${WEEK_EVENTS}, soonest first. Add a region to narrow it.`,
      inputSchema: z.object({ region: RegionArg.optional() }),
      annotations: READ_ONLY,
    },
    async (input) => result(thisWeek(data, input, origin, now())),
  );

  // Prompts. Each names this server's tools in the order to call them. Neither
  // talks about funds or investing, and neither ties the Leaderboard to money.
  const PromptArgs = z.object({ region: RegionArg, stage: StageArg });

  server.registerPrompt(
    "plan_my_founder_week",
    {
      title: "Plan my founder week",
      description: "A plan for the week ahead: events nearby, then next steps and a guide for the founder's stage.",
      argsSchema: PromptArgs,
    },
    ({ region: r, stage }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I am a Colorado founder at the ${stage} stage in the ${r} region. Help me plan my founder week with the Colorado Startups tools, in this order:`,
              `1. Call this_week with region "${r}" for the events in the next 7 days.`,
              `2. Call path with stage "${stage}" and region "${r}" for my next steps.`,
              `3. Call search with type "guide" and words that fit the ${stage} stage.`,
              "4. Call guide with the slug of the best match.",
              `5. If this_week found no events, call region with id "${r}" for the region's summary and listings.`,
              "Then lay out my week day by day: which events to go to and one step to take each day.",
              "Link each event, resource and guide. Tell me to check each organization's own site, since listings change.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "find_my_first_resources",
    {
      title: "Find my first resources",
      description: "The first Startup Resources for a founder's stage and region, with the region's overview and a guide.",
      argsSchema: PromptArgs,
    },
    ({ region: r, stage }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I am a Colorado founder at the ${stage} stage in the ${r} region. Find my first resources with the Colorado Startups tools, in this order:`,
              `1. Call region with id "${r}" for the region's overview and its listings.`,
              `2. Call path with stage "${stage}" and region "${r}" for up to ${PATH_STEPS} Startup Resources, each with why it fits.`,
              `3. Call search with type "guide" and words that fit the ${stage} stage.`,
              "4. Call guide with the slug of the best match.",
              `5. Call this_week with region "${r}" for an event this week where I can meet people from these organizations.`,
              "Then give me a short list: each resource, why it fits me and its link, then the guide to read first.",
              "Tell me to check each organization's own site, since listings change.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

/** The web-standard handler for one request, over data already loaded. */
export function mcpHandler(data: OpenData, origin: string, now?: () => Date): McpHttpHandler {
  return createMcpHandler(() => buildServer(data, origin, now), {
    legacy: "stateless",
    responseMode: "json",
    maxRequestBodySize: 64 * 1024,
    onerror: (err) => console.error("mcp:", err.message),
  });
}
