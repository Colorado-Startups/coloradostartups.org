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

  it("lists five read-only tools, each with a title", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: "POST", headers: HEADERS, body: rpc("tools/list") });
    expect(res.status).toBe(200);
    const { result } = await rpcBody(res);
    expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["company", "events", "path", "region", "search"]);
    for (const t of result.tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.title).toBeTruthy();
    }
  });

  it("refuses a browser Origin from another site with 403", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { ...HEADERS, Origin: "https://evil.example" },
      body: rpc("tools/list"),
    });
    expect(res.status).toBe(403);
  });

  it("accepts the site's own Origin", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { ...HEADERS, Origin: BASE },
      body: rpc("tools/list"),
    });
    expect(res.status).toBe(200);
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
    {
      id: "boulder-angels",
      name: "Boulder Angels",
      url: "https://example.org/angels",
      stage: "launch",
      substage: "investors",
      city: "Boulder",
      type: "investor",
      description: "Angel investors for early software startups.",
    },
    {
      id: "springs-space",
      name: "Springs Space Hub",
      url: "https://example.org/space",
      stage: "launch",
      substage: "develop",
      city: "Colorado Springs",
      type: "coworking",
      description: "Coworking for space startups.",
    },
    {
      id: "state-sbdc",
      name: "Statewide SBDC",
      url: "https://example.org/sbdc",
      stage: "launch",
      substage: "service-providers",
      city: "Statewide",
      type: "service-provider",
      description: "Free business advising for hardware and software founders.",
    },
    {
      id: "idea-class",
      name: "Idea Class",
      url: "https://example.org/class",
      stage: "idea",
      substage: "educate",
      city: "Boulder",
      type: "education",
      description: "A class on testing an idea.",
    },
  ],
  companies: [
    {
      id: "peak-robotics",
      name: "Peak Robotics",
      website: "https://example.org/peak",
      hq_city: "Boulder",
      founded_year: 2019,
      sector: "Robotics",
      description: "Robots for field work.",
      sources: ["https://example.org/peak/news"],
      groups: ["2026 honorees"],
      region: "photon-mountain",
    },
  ],
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
      resources: ["boulder-lab", "boulder-angels"],
    },
    {
      id: "space-peak",
      name: "Space Peak",
      summary: "The region for Colorado Springs.",
      url: "/regions/space-peak/",
      cities: ["Colorado Springs"],
      nearby: [],
      resources: ["springs-space"],
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
    expect(r.counts.resources).toBe(2);
    expect(r.url).toBe(`${BASE}/regions/photon-mountain/`);
  });

  it("rejects a region the site does not have", async () => {
    const body = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("region", { id: "atlantis" })));
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  it("answers a path for a stage in a region, local first and in substage order", async () => {
    const { result } = await rpcBody(
      await mcpHandler(DATA, BASE).fetch(call("path", { stage: "launch", region: "photon-mountain" })),
    );
    const p = JSON.parse(result.content[0].text);
    // Springs Space Hub is in another region; Idea Class is another stage.
    expect(p.steps.map((s: { id: string }) => s.id)).toEqual(["boulder-lab", "boulder-angels", "state-sbdc"]);
    expect(p.steps.length).toBeLessThanOrEqual(5);
    expect(p.steps[0]).toMatchObject({ step: 1, url: `${BASE}/ecosystem-canvas/#r-boulder-lab` });
    expect(p.steps[0].why).toContain("in your region");
    expect(p.note).toBeUndefined();
  });

  it("narrows a path to the founder's need", async () => {
    const { result } = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("path", { stage: "launch", need: "hardware" })));
    const p = JSON.parse(result.content[0].text);
    expect(p.steps.map((s: { id: string }) => s.id)).toEqual(["boulder-lab", "state-sbdc"]);
    expect(p.steps[0].why).toContain('"hardware"');
  });

  it("rejects a path for a stage the Canvas does not have", async () => {
    const body = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("path", { stage: "unicorn" })));
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  it("answers a company's public record", async () => {
    const { result } = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("company", { id: "peak-robotics" })));
    const c = JSON.parse(result.content[0].text);
    expect(c).toMatchObject({ id: "peak-robotics", city: "Boulder", founded: 2019, url: `${BASE}/leaderboard/#company-peak-robotics` });
  });

  it("returns a clear error for an unknown company", async () => {
    const { result } = await rpcBody(await mcpHandler(DATA, BASE).fetch(call("company", { id: "no-such-co" })));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain("No Leaderboard company with id no-such-co");
  });
});
