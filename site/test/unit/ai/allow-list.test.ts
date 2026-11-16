// The AI allow list (Paul, 2026-11-16): the site offers only Claude, OpenCode
// and open-weight models as a way to connect, open or ask. The one definition
// is 01_doctrine/ai_recommend.yaml; this gate reads it and fails on each file
// in its scope that names a never_offer term, printing file and line.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DATA = path.join(ROOT, "01_doctrine", "ai_recommend.yaml");

interface Entry {
  path: string;
  reason: string;
}
interface AllowList {
  source: { who: string; date: string; words: string };
  recommend: { name: string }[];
  never_offer: string[];
  scope: string[];
  exempt: Entry[];
  not_scanned?: Entry[];
}

const list = YAML.parse(readFileSync(DATA, "utf8")) as AllowList;

// Text files only; images and other binaries are skipped.
const TEXT = new Set([".astro", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".css", ".txt", ".html"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** One regex for every never_offer term: whole words, case-insensitive, longest first so chatgpt.com beats ChatGPT. */
function termPattern(terms: readonly string[]): RegExp {
  const longestFirst = [...terms].sort((x, y) => y.length - x.length);
  return new RegExp(`\\b(?:${longestFirst.map((t) => escape(t).replace(/ /gu, "\\s+")).join("|")})\\b`, "giu");
}

/** True when `rel` (a repo path with / separators) falls under the glob: a folder ending in /**, or one exact file. */
function covers(glob: string, rel: string): boolean {
  return glob.endsWith("/**") ? rel.startsWith(glob.slice(0, -2)) : rel === glob;
}

/** Each hit in one file's text, as "file:line: term". */
function hitsIn(rel: string, text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(pattern)) out.push(`${rel}:${i + 1}: ${m[0]}`);
  });
  return out;
}

function walk(abs: string): string[] {
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((d) =>
    d.name === "node_modules" ? [] : walk(path.join(abs, d.name)),
  );
}

/** Every text file in scope and not exempt, as repo-relative paths. */
function scannedFiles(): string[] {
  return list.scope
    .flatMap((glob) => walk(path.join(ROOT, glob.endsWith("/**") ? glob.slice(0, -3) : glob)))
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
    .filter((rel) => TEXT.has(path.extname(rel)))
    .filter((rel) => !list.exempt.some((e) => covers(e.path, rel)));
}

describe("the AI allow list data", () => {
  it("quotes the owner's rule with its date", () => {
    expect(list.source.who).toMatch(/Paul/u);
    expect(String(list.source.date)).toBe("2026-11-16");
    expect(list.source.words).toMatch(/We can recommend Claude/u);
  });

  it("recommends Claude, OpenCode and open-weight models, and nothing on the never list", () => {
    expect(list.recommend.map((r) => r.name)).toEqual(["Claude", "OpenCode", "open-weight models"]);
    const never = termPattern(list.never_offer);
    for (const r of list.recommend) expect(r.name.match(never), r.name).toBeNull();
  });

  it("keeps each exempt and not-scanned path real and explained", () => {
    for (const e of [...list.exempt, ...(list.not_scanned ?? [])]) {
      expect(e.reason?.trim().length, e.path).toBeGreaterThan(10);
      const base = e.path.endsWith("/**") ? e.path.slice(0, -3) : e.path;
      expect(existsSync(path.join(ROOT, base)), e.path).toBe(true);
    }
    // Each exempt path sits inside the scope, or it exempts nothing.
    for (const e of list.exempt) {
      const base = e.path.endsWith("/**") ? e.path.slice(0, -2) : e.path;
      expect(list.scope.some((g) => covers(g, base)), e.path).toBe(true);
    }
    expect(list.exempt.length).toBeLessThanOrEqual(3);
  });
});

describe("the AI allow list gate", () => {
  const pattern = termPattern(list.never_offer);

  it("finds each term in a known-bad sample, whole words, any case, with file and line", () => {
    const bad = ["<a href={x}>Open in ChatGPT</a>", "", "Ask gemini or GROK", "https://chatgpt.com/?q=1", "Try Meta  AI"].join("\n");
    expect(hitsIn("site/src/x.astro", bad, pattern)).toEqual([
      "site/src/x.astro:1: ChatGPT",
      "site/src/x.astro:3: gemini",
      "site/src/x.astro:3: GROK",
      "site/src/x.astro:4: chatgpt.com",
      "site/src/x.astro:5: Meta  AI",
    ]);
  });

  it("finds nothing in a known-clean sample", () => {
    const clean = [
      "Open in Claude fills the prompt in a new tab.",
      "In OpenCode or an open-weight model, paste the copied prompt.",
      "Metadata, GPTBot, grokking, megemini and taxai are other words.",
      "Google Maps and Claude Code.",
    ].join("\n");
    expect(hitsIn("clean.md", clean, pattern)).toEqual([]);
  });

  it("honors the folder and file forms of a scope or exempt glob", () => {
    expect(covers("site/src/**", "site/src/pages/a.astro")).toBe(true);
    expect(covers("site/src/**", "site/srcx/a.astro")).toBe(false);
    expect(covers("server.json", "server.json")).toBe(true);
    expect(covers("server.json", "site/server.json")).toBe(false);
  });

  it("finds no never-offer name in the site's UI source, the plugin, the MCP server or server.json", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("server.json");
    expect(files).toContain("site/src/components/ai/AskAi.astro");
    expect(files).not.toContain("site/src/pages/guides/startup-credits.astro");
    const hits = files.flatMap((rel) => hitsIn(rel, readFileSync(path.join(ROOT, rel), "utf8"), pattern));
    expect(hits, `Never offer these (01_doctrine/ai_recommend.yaml):\n${hits.join("\n")}`).toEqual([]);
  });
});
