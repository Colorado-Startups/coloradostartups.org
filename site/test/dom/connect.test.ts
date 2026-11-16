// Step A1a over the built site (run `npm run build` first; test:content does):
// /connect/ names only Claude and OpenCode (Paul, 2026-11-16,
// 01_doctrine/ai_recommend.yaml), then one neutral block for any other app
// that speaks MCP, then 5 asks in the shared Ask-your-AI row. The page's tool
// and prompt counts are read from worker/mcp/server.ts, so they cannot drift.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readDist, SITE_DIR } from "./pages";

const page = new DOMParser().parseFromString(readDist("connect/index.html"), "text/html");
const MCP_URL = "https://coloradostartups.org/mcp";
const cards = [...page.querySelectorAll<HTMLElement>("[data-client]")];
const card = (id: string) => page.querySelector<HTMLElement>(`[data-client="${id}"]`)!;
const server = readFileSync(path.join(SITE_DIR, "worker", "mcp", "server.ts"), "utf8");
const count = (re: RegExp) => (server.match(re) ?? []).length;
const fact = (name: string) =>
  [...page.querySelectorAll("[data-facts] > div")].find((d) => d.querySelector("dt")?.textContent === name)?.querySelector("dd")
    ?.textContent;

describe("/connect/", () => {
  it("names Claude, Claude Code and OpenCode, in that order, in two groups", () => {
    expect(cards.map((c) => c.dataset.client)).toEqual(["claude", "claude-code", "opencode"]);
    expect([...page.querySelectorAll<HTMLElement>("[data-group]")].map((g) => g.dataset.group)).toEqual([
      "claude",
      "opencode",
    ]);
  });

  it("pins its tool and prompt counts to the server", () => {
    expect(fact("Tools")).toBe(String(count(/server\.registerTool\(/g)));
    expect(fact("Prompts")).toBe(String(count(/server\.registerPrompt\(/g)));
    expect(fact("Key or sign in")).toBe("None");
  });

  it("shows the /mcp URL with a copy button", () => {
    expect(page.querySelector("[data-mcp-url]")?.textContent).toBe(MCP_URL);
    expect(page.querySelector('button[data-copy="mcp-url"]')).not.toBeNull();
    expect(page.body.textContent).toContain("io.github.Colorado-Startups/coloradostartups");
    expect(page.body.textContent).toContain("in apps that support MCP Apps");
  });

  it("gives Claude Code and OpenCode one command each, and OpenCode's config turns OAuth off", () => {
    expect(page.getElementById("cmd-claude-code")?.textContent).toBe(
      `claude mcp add --transport http coloradostartups ${MCP_URL}`,
    );
    expect(page.getElementById("cmd-opencode")?.textContent).toBe(`opencode mcp add coloradostartups --url ${MCP_URL}`);
    const config = JSON.parse(page.getElementById("cfg-opencode")!.textContent!);
    expect(config.mcp.servers.coloradostartups).toEqual({ type: "remote", url: MCP_URL, oauth: false });
    expect(card("opencode").textContent).toContain("open-weight models");
  });

  it("gives claude.ai steps with no sign in, the skill and the Claude Code plugin", () => {
    expect(card("claude").textContent).toContain("No sign in");
    expect(card("claude").querySelectorAll("ol li").length).toBeGreaterThan(0);
    expect(card("claude").querySelector('a[href="/downloads/colorado-startups-skill.zip"]')).not.toBeNull();
    expect(page.getElementById("plugin-claude-code")?.textContent).toBe(
      "claude plugin marketplace add Colorado-Startups/coloradostartups.org\n" +
        "claude plugin install colorado-startups@colorado-startups",
    );
  });

  it("has one neutral block for any other MCP app, with the URL and a copy button", () => {
    const any = page.querySelector<HTMLElement>("[data-any-mcp]")!;
    expect(any.querySelector("h2")?.textContent).toBe("Any other app that speaks MCP");
    expect(any.querySelector("code")?.textContent).toBe(MCP_URL);
    expect(any.querySelector("button[data-copy]")).not.toBeNull();
    expect(any.textContent).toContain("no key and no sign in");
    expect(any.textContent).toContain("streamable HTTP");
    // It names no product: no links out, and only the generic words.
    expect(any.querySelectorAll("a")).toHaveLength(0);
  });

  it("lists 5 asks, each a shared row with Copy prompt and Open in Claude only", () => {
    const asks = [...page.querySelectorAll("[data-asks] > li")];
    expect(asks).toHaveLength(5);
    for (const ask of asks) {
      const row = ask.querySelector("[data-ask-ai]")!;
      const actions = [...row.querySelectorAll(".btn-row > button, .btn-row > a")].map((a) => a.textContent?.trim());
      expect(actions).toEqual(["Copy prompt", "Open in Claude"]);
      const link = row.querySelector("a")!.getAttribute("href")!;
      expect(link.startsWith("https://claude.ai/new?q=")).toBe(true);
      expect(new URL(link).searchParams.get("q")).toContain(MCP_URL);
      expect(row.querySelector("textarea")?.textContent).toContain(row.querySelector("h3")!.textContent!);
    }
  });

  it("is linked from /ask/#connect and the home page", () => {
    const ask = new DOMParser().parseFromString(readDist("ask/index.html"), "text/html");
    expect(ask.querySelector('#connect a[href="/connect/"]')).not.toBeNull();
    const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
    expect(home.querySelector('a[href="/connect/"]')).not.toBeNull();
  });
});
