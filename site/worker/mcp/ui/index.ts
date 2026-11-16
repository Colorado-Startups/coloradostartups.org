// MCP Apps for /mcp: two cards a host that supports MCP Apps (Claude, VS Code,
// Goose) renders in a sandboxed iframe when this_week or region answers. The
// tools' results stay exactly as they were: a host without MCP Apps sees the
// same text, and the cards read the JSON in that text (view.mjs toolData).
// Spec: MCP Apps 2026-01-26 (github.com/modelcontextprotocol/ext-apps,
// specification/2026-01-26/apps.mdx, read at tag v2.1.0 on 2026-11-16).
import type { McpServer } from "@modelcontextprotocol/server";

import { REGION_HTML, THIS_WEEK_HTML } from "./apps.generated";

/** "`mimeType` MUST be `text/html;profile=mcp-app`" (spec, UI Resource Format). */
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

export const THIS_WEEK_UI = "ui://coloradostartups/this-week";
export const REGION_UI = "ui://coloradostartups/region";

/**
 * A tool's `_meta` pointing at its card: `ui.resourceUri`, and the flat
 * `ui/resourceUri` key the spec marks deprecated, which hosts from before the
 * nested form still read. The official server helper (ext-apps registerAppTool)
 * sets both the same way.
 */
export function uiToolMeta(resourceUri: string) {
  return { ui: { resourceUri }, "ui/resourceUri": resourceUri };
}

const CARDS = [
  {
    name: "this_week_card",
    uri: THIS_WEEK_UI,
    title: "This week card",
    description: "The week's Colorado startup events as compact cards, for the this_week tool.",
    html: THIS_WEEK_HTML,
  },
  {
    name: "region_card",
    uri: REGION_UI,
    title: "Region card",
    description: "One Colorado Startups region: its cities, a map, its next events and a few companies, for the region tool.",
    html: REGION_HTML,
  },
] as const;

/**
 * Registers both cards as resources. No `csp` in their metadata: the spec's
 * restrictive default (connect-src 'none', no outside origins) is what the
 * cards need, since they load nothing and fetch nothing.
 */
export function registerUiResources(server: McpServer): void {
  for (const card of CARDS) {
    server.registerResource(card.name, card.uri, { title: card.title, description: card.description, mimeType: UI_MIME_TYPE }, async () => ({
      contents: [{ uri: card.uri, mimeType: UI_MIME_TYPE, text: card.html, _meta: { ui: { prefersBorder: true } } }],
    }));
  }
}
