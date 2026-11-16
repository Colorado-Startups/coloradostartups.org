// A3a: the "Ask your AI" prompt names the page's subject and the MCP server,
// and its one encoded link, to Claude, stays under 2,000 characters.
import { describe, expect, it } from "vitest";

import { askAiLinks, buildPrompt, claudeLink, MAX_LINK, MCP_URL } from "../../../src/components/ai/prompt";

describe("ask-AI prompt", () => {
  it("names the subject, the page and the MCP server", () => {
    const { prompt } = askAiLinks({ subject: "Funding programs", path: "/guides/funding-programs/" });
    expect(prompt).toContain('"Funding programs"');
    expect(prompt).toContain("https://coloradostartups.org/guides/funding-programs/");
    expect(prompt).toContain(MCP_URL);
  });

  it("uses the question it is given", () => {
    const { prompt } = askAiLinks({ subject: "Boulder", path: "/regions/boulder/", question: "Who invests here?" });
    expect(prompt).toContain("Who invests here?");
  });

  it("encodes the prompt into the Claude link, the only link it makes", () => {
    const links = askAiLinks({ subject: 'Fort Collins & "Loveland"?', path: "/regions/x/" });
    const { prompt, claude } = links;
    expect(Object.keys(links).sort()).toEqual(["claude", "prompt"]);
    expect(claude.startsWith("https://claude.ai/new?q=")).toBe(true);
    expect(new URL(claude).searchParams.get("q")).toBe(prompt);
    // Only the one ?q= separator; the prompt's own & ? # " and spaces are encoded.
    expect(claude.slice(claude.indexOf("?q=") + 3)).not.toMatch(/[ "&?#]/u);
    expect(claudeLink("a b")).toBe("https://claude.ai/new?q=a%20b");
    expect(claudeLink("a&b")).toBe("https://claude.ai/new?q=a%26b");
  });

  it("keeps the link under the cap, and still names the subject, for a long subject and question", () => {
    const subject = `Startup resources ${"for founders in every corner of Colorado ".repeat(40)}`;
    const question = `What ${"should I really know ".repeat(80)}?`;
    const { prompt, claude } = askAiLinks({ subject, path: "/guides/long/", question });
    expect(claude.length).toBeLessThan(MAX_LINK);
    expect(prompt).toContain('"Startup resources');
    expect(prompt).toContain(MCP_URL);
  });

  it("leaves a short prompt untouched", () => {
    const links = askAiLinks({ subject: "Denver", path: "/regions/denver/" });
    expect(links.prompt).toBe(buildPrompt("Denver", "/regions/denver/"));
    expect(links.claude.length).toBeLessThan(MAX_LINK);
  });
});
