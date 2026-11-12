// Static guard for the Resourcus panel (OWASP LLM05, improper output
// handling). Model text is untrusted; the panel must render it as text, never
// as HTML. The behavioral counterpart is e2e/l4.spec.ts, which feeds XSS
// payloads through a mocked /api/ask in a real browser.

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { safeHref, sitePath } from "../../../src/components/resourcus/panel";

const DIR = new URL("../../../src/components/resourcus/", import.meta.url);
const files = readdirSync(DIR).filter((f) => /\.(astro|ts|tsx|js|mjs)$/.test(f));
const sources = files.map((f) => [f, readFileSync(new URL(f, DIR), "utf8")] as const);

// Sink names are assembled from pieces so this file does not trip tools that
// flag the literal words.
const SINKS: [string, RegExp][] = [
  ["inner" + "HTML", new RegExp("\\.inner" + "HTML\\b")],
  ["outer" + "HTML", new RegExp("\\.outer" + "HTML\\b")],
  ["insertAdjacent" + "HTML", new RegExp("insertAdjacent" + "HTML")],
  ["document.write", new RegExp("document\\.wr" + "ite")],
  ["createContextual" + "Fragment", new RegExp("createContextual" + "Fragment")],
  ["DOM" + "Parser", new RegExp("DOM" + "Parser")],
  ["set:" + "html", new RegExp("set:" + "html")],
  ["src" + "doc", new RegExp("\\bsrc" + "doc\\b")],
  ["ev" + "al(", new RegExp("\\bev" + "al\\s*\\(")],
  ["new Func" + "tion", new RegExp("new\\s+Func" + "tion\\b")],
  ["inline on* handler", /setAttribute\(\s*["']on/i],
];

describe("Resourcus panel renders untrusted text as text", () => {
  it("scans the panel's files", () => {
    expect(files).toEqual(expect.arrayContaining(["ResourcusPanel.astro", "panel.ts"]));
  });

  it.each(SINKS)("never uses %s", (_name, re) => {
    for (const [file, src] of sources) expect(src, `${file}`).not.toMatch(re);
  });

  it("writes answer and card text through textContent", () => {
    const panel = sources.find(([f]) => f === "panel.ts")![1];
    expect(panel).toMatch(/\.textContent\s*=\s*text/);
    expect(panel).toMatch(/el\("p", "resourcus__answer", res\.answer\)/);
  });
});

describe("link guards", () => {
  it.each([
    ["https://example.org/x", "https://example.org/x"],
    ["http://example.org/", "http://example.org/"],
    ["javascript:alert(1)", null],
    ["data:text/html,<b>x</b>", null],
    ["//evil.example", null],
    ["not a url", null],
  ])("safeHref(%j)", (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });

  it.each([
    ["/ecosystem-canvas/", "/ecosystem-canvas/"],
    ["//evil.example/", null],
    ["/\\evil.example", null],
    ["https://evil.example/", null],
    ["javascript:alert(1)", null],
  ])("sitePath(%j)", (input, expected) => {
    expect(sitePath(input)).toBe(expected);
  });
});
