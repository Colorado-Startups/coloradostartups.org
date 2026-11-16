// /mcp: the site's keyless, read-only MCP server (Streamable HTTP, stateless).
// worker/index.ts routes the path here; wrangler.jsonc lists it in
// run_worker_first. Two checks: a browser Origin must be this site's own host
// (the MCP spec's DNS-rebinding rule; Claude and OpenCode send no Origin), then
// MCP_RATE_LIMIT per IP, which fails open like every limiter here
// (lib/ratelimit.ts). No tool spends money: they read the
// /data/*.json files through ASSETS (data.ts).
import { originValidationResponse } from "@modelcontextprotocol/server";

import { isRateLimited, webKey } from "../lib/ratelimit";
import { loadOpenData } from "./data";
import { mcpHandler } from "./server";

export const MCP_PATH = "/mcp";

/** Where a person who opens /mcp in a browser lands: the connect steps. */
const MCP_HUMAN_PAGE = "/connect/";

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const accept = request.headers.get("Accept") ?? "";
  if (request.method === "GET" && accept.includes("text/html")) {
    return new Response(null, { status: 303, headers: { Location: MCP_HUMAN_PAGE } });
  }
  // The host that served this request: production or staging, whichever it is.
  const rejected = originValidationResponse(request, [new URL(request.url).hostname]);
  if (rejected) return rejected;
  if (await isRateLimited(env.MCP_RATE_LIMIT, webKey(request, MCP_PATH))) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests. Try again in a minute." } },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  const data = await loadOpenData(env.ASSETS);
  return mcpHandler(data, new URL(request.url).origin).fetch(request);
}
