// server.json, the MCP Registry listing (.github/workflows/mcp-registry.yml),
// must describe the server site/worker/mcp declares: the same name, title,
// version and /mcp URL. The registry's own limits are checked here too, so a
// bad edit fails in CI before the publish job does.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MCP_PATH } from "../../worker/mcp";
import { SERVER_NAME } from "../../worker/mcp/server";

const SITE_ORIGIN = "https://coloradostartups.org";
// GitHub OIDC grants io.github.<repository_owner>/*, matched case sensitively
// (modelcontextprotocol/registry internal/auth/jwt.go, read 2026-11-15).
const NAMESPACE = "io.github.Colorado-Startups";
const SERVER_SOURCE = readFileSync(new URL("../../worker/mcp/server.ts", import.meta.url), "utf8");

interface Remote {
  type: string;
  url: string;
}

const listing = JSON.parse(readFileSync(new URL("../../../server.json", import.meta.url), "utf8")) as Record<string, unknown>;

function declared(field: "title" | "version"): string | undefined {
  return SERVER_SOURCE.match(new RegExp(`new McpServer\\(\\{[^}]*\\b${field}: "([^"]+)"`))?.[1];
}

describe("server.json for the MCP Registry", () => {
  it("uses the registry schema and no packages", () => {
    expect(listing.$schema).toBe("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    expect(listing).not.toHaveProperty("packages");
  });

  it("names the server the worker declares, in the org's GitHub namespace", () => {
    expect(listing.name).toBe(`${NAMESPACE}/${SERVER_NAME}`);
    expect(listing.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  });

  it("matches the worker's title and version", () => {
    expect(declared("title")).toBeDefined();
    expect(listing.title).toBe(declared("title"));
    expect(listing.version).toBe(declared("version"));
  });

  it("keeps the description within the registry's 100 characters", () => {
    expect(typeof listing.description).toBe("string");
    expect((listing.description as string).length).toBeGreaterThan(0);
    expect((listing.description as string).length).toBeLessThanOrEqual(100);
  });

  it("points one streamable-http remote at the site's /mcp", () => {
    expect(listing.remotes).toEqual([{ type: "streamable-http", url: `${SITE_ORIGIN}${MCP_PATH}` }] satisfies Remote[]);
  });

  it("links this repository", () => {
    expect(listing.repository).toEqual({ url: "https://github.com/Colorado-Startups/coloradostartups.org", source: "github" });
  });
});

// Publishing writes under the org's name. The job runs in the mcp-registry
// environment, whose branch policy allows main alone, so a branch cannot
// publish (review of #82). The token it asks for stays as narrow as it was.
describe("the registry publish workflow", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/mcp-registry.yml", import.meta.url), "utf8");

  it("runs its publish job in the main-only mcp-registry environment", () => {
    expect(workflow).toMatch(/^ {4}environment: mcp-registry$/m);
  });

  it("grants nothing at the top level, and the job only an OIDC token and read access", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).toMatch(/^ {4}permissions:\n {6}id-token: write\n {6}contents: read\n/m);
  });
});

// The cosign installer needs envsubst, which the ubuntu-slim image lacks: the
// first publish run failed on it. Pin the job to the standard image.
describe("the registry publish workflow's runner", () => {
  it("runs on ubuntu-latest, where the cosign installer works", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/mcp-registry.yml", import.meta.url), "utf8");
    expect(workflow).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
  });
});
