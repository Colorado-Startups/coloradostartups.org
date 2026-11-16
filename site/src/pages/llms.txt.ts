// GET /llms.txt: the site summary for AI assistants (llmstxt.org shape), built
// at build time from the data the pages read, so it cannot drift from them.
// It replaced the hand-written site/public/llms.txt (step A2a, 2026-11-15),
// which had listed Greeley as a Fusion Canyon city and described Space Peak
// as "Colorado Springs and the Pikes Peak region".
//
// Sources: data/regions/*.yaml (REGIONS), data/team/dwarves.yaml (each
// keeper's role and exact disclosure), lib/guides/core.ts (guide titles),
// lib/data/license.ts (the /data/ files and license) and worker/mcp/tools.ts
// (the per-tool result cap). Pages without a data source keep a line here.
//
// buildLlmsTxt() is pure, so test/unit/l29/keeper-disclosure.test.ts checks
// the same text the build writes; test/dom/l13/info-pages.test.ts checks
// dist/llms.txt.
import { DwarfSchema, type Region, RESOURCES_JSON_PATH } from "@cs/shared";
import type { APIContext } from "astro";
import { parse } from "yaml";

import { CONTACT_EMAIL } from "../components/info/links";
import { CARD_FIELDS, DATA_FILES, DATA_PAGE_PATH, LICENSE } from "../lib/data/license";
import { GUIDE_GROUPS, GUIDES, GUIDES_INDEX, guidePath } from "../lib/guides/core";
import { REGIONS } from "../lib/regions/match";
import { andList } from "../lib/text";
import { MAX_RESULTS } from "../../worker/mcp/tools";

/** The parts of a keeper llms.txt says: its name, what it does, and its disclosure line. */
export interface LlmsKeeper {
  name: string;
  role: string;
  disclosure: string;
}

const dwarvesFile = import.meta.glob<string>("../../../data/team/dwarves.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The keepers from data/team/dwarves.yaml, in file order, validated with DwarfSchema. */
export const KEEPERS: readonly LlmsKeeper[] = Object.values(dwarvesFile).flatMap((text) =>
  (parse(text) as unknown[]).map((doc) => DwarfSchema.parse(doc)),
);

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One keeper as two or more sentences, each naming it with "AI agent" in the same sentence. */
function keeperLines(k: LlmsKeeper): string {
  return `${k.name}, an AI agent, ${lowerFirst(k.role.trim())} ${k.disclosure.trim()}`;
}

function regionLine(r: Region, link: (path: string) => string): string {
  const nearby = r.nearby.length > 0 ? ` Nearby towns: ${andList(r.nearby)}.` : "";
  return `- [${r.name}](${link(`/regions/${r.id}/`)}): The region for ${andList(r.cities)}.${nearby}`;
}

function dataFileLine(f: (typeof DATA_FILES)[number], link: (path: string) => string): string {
  const what =
    f.path === RESOURCES_JSON_PATH
      ? `Every active Startup Resources listing, each with its ${andList(CARD_FIELDS.map((c) => c.key))}`
      : capitalize(f.what);
  return `- [${f.path.split("/").at(-1)}](${link(f.path)}): ${what}. Free to reuse under ${LICENSE.name}, with credit to Colorado Startups.`;
}

/** The whole llms.txt. Pure: the data comes in as arguments, with the site's own as defaults. */
export function buildLlmsTxt(
  site: URL,
  { regions = REGIONS, keepers = KEEPERS }: { regions?: readonly Region[]; keepers?: readonly LlmsKeeper[] } = {},
): string {
  const link = (path: string) => new URL(path, site).href;
  const guideSlugs = GUIDE_GROUPS.flatMap((g) => g.slugs);

  const lines = [
    "# Colorado Startups",
    "",
    "> Colorado Startups is a community of entrepreneurs building companies in Colorado. Founders come first. People who join startups, back them or serve them are welcome too.",
    "",
    "Colorado Startups, Ltd. runs the community and this website from Denver. Paul Foley founded it in 2014 and leads it as Founder & President. The community meets in a Slack workspace and a LinkedIn Group. Its newsletter is called Startupers.",
    "",
    [
      "AI agents help on this site, and each one is disclosed as an AI agent wherever it appears.",
      ...keepers.map(keeperLines),
      "Only people moderate the groups or hold Connector and organizer seats. The AI agents never do.",
    ].join(" "),
    "",
    "## For founders",
    "",
    `- [Home](${link("/")}): The ways into the community, and a welcome desk that points each visitor to the right place.`,
    `- [Startup Resources](${link("/ecosystem-canvas/")}): A directory of Colorado programs, events, investors and services for founders, sorted by company stage. Resourcus, an AI agent, answers questions about it.`,
    `- [Community](${link("/community/")}): Pick a way in (the Slack, the LinkedIn Group, the LinkedIn Page or the Startupers newsletter), the house rules, and a welcome desk that points each visitor to the right place.`,
    `- [Join the Slack](${link("/slack/")}): The one public way to ask for an invite to the Colorado Startups Slack. It opens a Google Form.`,
    `- [Leaderboard](${link("/leaderboard/")}): Colorado companies that Colorado Startups recognizes, and the form to nominate one.`,
    `- [How the Leaderboard works](${link("/leaderboard/#method")}): How each edition is chosen and checked. The first verified edition will rank companies by revenue growth.`,
    `- [Founders forum](${link("/founders/")}): A forum for founders only. It opens later.`,
    "",
    "## Guides",
    "",
    `- [${GUIDES_INDEX.title}](${link(GUIDES_INDEX.path)}): ${GUIDES_INDEX.description}`,
    ...guideSlugs.map((slug) => `- [${GUIDES[slug].title}](${link(guidePath(slug))}): ${GUIDES[slug].description}`),
    `- [Startup credits for founders](${link("/guides/startup-credits/")}): Cloud, GPU and AI credit programs a founder can claim, grouped by what each one asks. Amounts come from each provider's own page, and computed totals are labeled. Colorado Startups is not affiliated with these programs.`,
    "",
    "## Regions",
    "",
    `- [Regions](${link("/regions/")}): The founder communities of ${andList(regions.map((r) => r.name))}.`,
    ...regions.map((r) => regionLine(r, link)),
    "",
    "## Stay in touch",
    "",
    `- [Startupers newsletter](${link("/newsletter/")}): Colorado wins, a builder lesson and upcoming events, every other Tuesday from Nov 17, 2026.`,
    `- [Event calendar](${link("/event-calendar/")}): Startup events across Colorado in one Google Calendar, plus Colorado Startups events on Luma.`,
    `- [Get involved](${link("/get-involved/")}): Open moderator, organizer and project roles for people in the community.`,
    `- [Team](${link("/team/")}): The people who run Colorado Startups, and the AI agents that help them.`,
    `- [AI agents](${link("/agents/")}): The AI agents on this site and the open-source AI agent projects for your own AI tool, each with its disclosure line.`,
    `- [Code of Conduct](${link("/code-of-conduct/")}): How we post and treat each other in the Slack and the LinkedIn Group.`,
    `- [Contact](${link("/contact/")}): Email ${CONTACT_EMAIL}, or write to the mailing address in Denver.`,
    `- [Sponsors](${link("/sponsors/")}): The people and companies who sponsor Colorado Startups through GitHub Sponsors.`,
    "",
    "## Data and feeds",
    "",
    `- [Open data](${link(DATA_PAGE_PATH)}): Every /data/ file, the ${LICENSE.name} license, the fields and a credit line to copy.`,
    ...DATA_FILES.map((f) => dataFileLine(f, link)),
    `- [Ask](${link("/ask/")}): Search the whole site by type, ask Resourcus, an AI agent, or connect Claude or OpenCode to the MCP server.`,
    `- [MCP server](${link("/mcp")}): A free, read-only, keyless MCP server (Streamable HTTP). Its tools search, events and region read the /data/ files and return at most ${MAX_RESULTS} results each.`,
    `- [Dispatches JSON Feed](${link("/feed.json")}): News from Colorado Startups as a JSON Feed.`,
    `- [Dispatches RSS](${link("/rss.xml")}): The same news as an RSS feed.`,
    "",
    "## Optional",
    "",
    `- [Dispatches](${link("/dispatches/")}): News from Colorado Startups, newest first.`,
    `- [Privacy Policy](${link("/privacy/")}): What the site collects, who helps run it, and how to ask us to delete your information.`,
    "",
  ];
  return lines.join("\n");
}

export function GET({ site }: APIContext) {
  return new Response(buildLlmsTxt(site!), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
