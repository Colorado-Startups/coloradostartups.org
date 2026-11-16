// The /mcp server: keyless, read-only and stateless. Each request gets a
// fresh McpServer from createMcpHandler, which serves the 2026-07-28 protocol
// and, for older clients, the stateless 2025 Streamable HTTP fallback. Three
// tools, each read-only and capped at 25 results (tools.ts).
import { REGION_IDS } from "@cs/shared";
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import * as z from "zod";

import type { OpenData } from "./data";
import { events, MAX_RESULTS, region, search, SEARCH_TYPES } from "./tools";

export const SERVER_NAME = "coloradostartups";

export const INSTRUCTIONS = [
  "Colorado Startups (coloradostartups.org) is a community of entrepreneurs building companies in Colorado.",
  "This server is read-only and needs no key.",
  "It searches the site's open data: Startup Resources (programs, investors, coworking and services for founders), the Leaderboard's honoree companies, the guides for founders, and the event calendar.",
  "The community has three regions: Photon Mountain (Boulder, Golden, Arvada and Denver), Space Peak (Colorado Springs and Fountain) and Fusion Canyon (Fort Collins, Loveland and Windsor).",
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

  return server;
}

/** The web-standard handler for one request, over data already loaded. */
export function mcpHandler(data: OpenData, origin: string): McpHttpHandler {
  return createMcpHandler(() => buildServer(data, origin), {
    legacy: "stateless",
    responseMode: "json",
    maxRequestBodySize: 64 * 1024,
    onerror: (err) => console.error("mcp:", err.message),
  });
}
