import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { OpenData } from "../../../worker/mcp/data";
import { mcpHandler, SERVER_NAME } from "../../../worker/mcp/server";

const BASE = "https://coloradostartups.org";
const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

// The body of a JSON-RPC answer, whether it came as JSON or as one SSE event.
async function rpcBody(res: Response): Promise<any> {
  const text = await res.text();
  if (res.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(data!.slice(6));
  }
  return JSON.parse(text);
}

const rpc = (method: string, params: unknown = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } };

describe("/mcp", () => {
  it("initializes with the server's name and instructions", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: "POST", headers: HEADERS, body: rpc("initialize", INIT) });
    expect(res.status).toBe(200);
    const body = await rpcBody(res);
    expect(body.result.serverInfo.name).toBe(SERVER_NAME);
    expect(body.result.instructions).toContain("Colorado Startups");
  });

  it("lists three read-only tools", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: "POST", headers: HEADERS, body: rpc("tools/list") });
    expect(res.status).toBe(200);
    const { result } = await rpcBody(res);
    expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["events", "region", "search"]);
    for (const t of result.tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("sends a browser to the connect steps", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { headers: { Accept: "text/html" }, redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/ask/#connect");
  });
});

const DATA: OpenData = {
  resources: [
    {
      id: "boulder-lab",
      name: "Boulder Lab",
      url: "https://example.org/lab",
      stage: "launch",
      substage: "develop",
      city: "Boulder",
      type: "accelerator",
      description: "An accelerator for hardware startups.",
    },
  ],
  companies: [],
  events: [],
  guides: [],
  regions: [
    {
      id: "photon-mountain",
      name: "Photon Mountain",
      summary: "The region for Boulder and Denver.",
      url: "/regions/photon-mountain/",
      cities: ["Boulder"],
      nearby: [],
      resources: ["boulder-lab"],
    },
  ],
};

const call = (name: string, args: unknown) =>
  new Request(`${BASE}/mcp`, { method: "POST", headers: HEADERS, body: rpc("tools/call", { name, arguments: args }) });

describe("tools/call", () => {
  it("answers a search from the open data with absolute links", async () => {
    const { result } = await rpcBody(
      await mcpHandler(DATA, BASE).fetch(call("search", { words: "accelerator", region: "photon-mountain" })),
    );
    const hits = JSON.parse(result.content[0].text);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ type: "resource", id: "boulder-lab", url: `${BASE}/ecosystem-canvas/#r-boulder-lab` });
  });

  it("answers a region with its counts", async () => {
    const { result } = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("region", { id: "photon-mountain" })));
    const r = JSON.parse(result.content[0].text);
    expect(r.counts.resources).toBe(1);
    expect(r.url).toBe(`${BASE}/regions/photon-mountain/`);
  });

  it("rejects a region the site does not have", async () => {
    const body = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("region", { id: "atlantis" })));
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });
});
