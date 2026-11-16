// Step A1a over the built site (run `npm run build` first; test:content does):
// /connect/ shows one card per AI client in data/ai-clients.yaml, 7 in all
// (3 one click, 2 one command, 2 guided), the /mcp URL, and 5 things to ask.
// Each deep link decodes to the vendor's documented form, pointing at /mcp.
// Claude Code also offers the repo's plugin, Claude the skill download, and
// each ask opens in Claude or ChatGPT with the shared Ask-your-AI prompt.
import { describe, expect, it } from "vitest";

import { readDist } from "./pages";

const page = new DOMParser().parseFromString(readDist("connect/index.html"), "text/html");
const MCP_URL = "https://coloradostartups.org/mcp";
const cards = [...page.querySelectorAll<HTMLElement>("[data-client]")];
const card = (id: string) => page.querySelector<HTMLElement>(`[data-client="${id}"]`)!;
const href = (id: string) => card(id).querySelector("a")!.getAttribute("href")!;

describe("/connect/", () => {
  it("has 7 client cards: 3 one click, 2 one command, 2 guided", () => {
    expect(cards.map((c) => c.dataset.client)).toEqual([
      "claude",
      "chatgpt",
      "cursor",
      "vscode",
      "goose",
      "claude-code",
      "opencode",
    ]);
    const effort = (e: string) => cards.filter((c) => c.dataset.effort === e).length;
    expect([effort("one-click"), effort("one-command"), effort("guided")]).toEqual([3, 2, 2]);
  });

  it("shows the /mcp URL with a copy button", () => {
    expect(page.querySelector("[data-mcp-url]")?.textContent).toBe(MCP_URL);
    expect(page.querySelector('button[data-copy="mcp-url"]')).not.toBeNull();
  });

  it("builds each deep link in the vendor's form", () => {
    const cursor = new URL(href("cursor"));
    expect(cursor.protocol + "//" + cursor.host + cursor.pathname).toBe("cursor://anysphere.cursor-deeplink/mcp/install");
    expect(cursor.searchParams.get("name")).toBe("coloradostartups");
    expect(JSON.parse(atob(cursor.searchParams.get("config")!))).toEqual({ url: MCP_URL });

    const vscode = href("vscode");
    expect(vscode.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(vscode.slice("vscode:mcp/install?".length)))).toEqual({
      name: "coloradostartups",
      type: "http",
      url: MCP_URL,
    });

    const goose = new URL(href("goose"));
    expect(goose.protocol).toBe("goose:");
    expect(Object.fromEntries(goose.searchParams)).toEqual({
      url: MCP_URL,
      type: "streamable_http",
      id: "coloradostartups",
      name: "Colorado Startups",
    });
  });

  it("gives Claude Code and OpenCode one command each, and OpenCode's config turns OAuth off", () => {
    expect(page.getElementById("cmd-claude-code")?.textContent).toBe(
      `claude mcp add --transport http coloradostartups ${MCP_URL}`,
    );
    expect(page.getElementById("cmd-opencode")?.textContent).toBe(`opencode mcp add coloradostartups --url ${MCP_URL}`);
    const config = JSON.parse(page.getElementById("cfg-opencode")!.textContent!);
    expect(config.mcp.servers.coloradostartups).toEqual({ type: "remote", url: MCP_URL, oauth: false });
  });

  it("offers the Claude Code plugin and the claude.ai skill", () => {
    expect(page.getElementById("plugin-claude-code")?.textContent).toBe(
      "claude plugin marketplace add Colorado-Startups/coloradostartups.org\n" +
        "claude plugin install colorado-startups@colorado-startups",
    );
    expect(card("claude").querySelector('a[href="/downloads/colorado-startups-skill.zip"]')).not.toBeNull();
  });

  it("gives Claude and ChatGPT guided steps with no sign in", () => {
    expect(card("claude").textContent).toContain("No sign in");
    expect(card("chatgpt").textContent).toContain("Add custom MCP server");
    for (const id of ["claude", "chatgpt"]) expect(card(id).querySelectorAll("ol li").length).toBeGreaterThan(0);
  });

  it("lists 5 things to ask, each opening in Claude and ChatGPT with the /mcp prompt", () => {
    const asks = [...page.querySelectorAll("[data-asks] li")];
    expect(asks).toHaveLength(5);
    for (const ask of asks) {
      const links = [...ask.querySelectorAll("a")].map((a) => a.getAttribute("href")!);
      expect(links.map((h) => h.split("?")[0])).toEqual(["https://claude.ai/new", "https://chatgpt.com/"]);
      for (const h of links) expect(new URL(h).searchParams.get("q")).toContain(MCP_URL);
    }
  });

  it("is linked from /ask/#connect and the home page", () => {
    const ask = new DOMParser().parseFromString(readDist("ask/index.html"), "text/html");
    expect(ask.querySelector('#connect a[href="/connect/"]')).not.toBeNull();
    const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
    expect(home.querySelector('a[href="/connect/"]')).not.toBeNull();
  });
});
