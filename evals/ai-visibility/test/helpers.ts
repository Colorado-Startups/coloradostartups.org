// Shared test helpers: recorded fixtures, a fake fetch that serves them by
// URL, and Deps that write to a temp directory. Nothing here touches the
// network or the real results/ folder, and every temp directory is gone after
// its test (#332).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "node:test";
import { fileURLToPath } from "node:url";

import type { Deps } from "../cli.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, "test/fixtures", name), "utf8")) as unknown;
}

// Fake key values. None looks like a real key, so secretlint stays quiet,
// and each is distinctive enough to grep for in every file a run writes.
export const FAKE_KEYS = {
  ANTHROPIC_API_KEY: "fake-anthropic-key-L27-test",
  OPENAI_API_KEY: "fake-openai-key-L27-test",
  PERPLEXITY_API_KEY: "fake-perplexity-key-L27-test",
} as const;

export interface FakeCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status: number; body: unknown } | (() => { status: number; body: unknown });

/**
 * A fetch that answers by URL prefix. Each route holds a list of replies,
 * served in order and then cycled, so a two-reply route plays
 * pause_turn, answer, pause_turn, answer for successive questions.
 */
export function fakeFetch(routes: Record<string, Reply[]>): { fetch: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const served = new Map<string, number>();
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, headers, body: JSON.parse(String(init?.body ?? "null")) as unknown });
    const prefix = Object.keys(routes).find((p) => url.startsWith(p));
    if (!prefix) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    const list = routes[prefix]!;
    const n = served.get(prefix) ?? 0;
    served.set(prefix, n + 1);
    const pick = list[n % list.length]!;
    const reply = typeof pick === "function" ? pick() : pick;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fn as typeof fetch, calls };
}

export const ANTHROPIC = "https://api.anthropic.com/";
export const OPENAI = "https://api.openai.com/";
export const PERPLEXITY = "https://api.perplexity.ai/";

/** The three recorded happy-path routes. */
export function happyRoutes(): Record<string, Reply[]> {
  const [pause, answer] = fixture("anthropic-pause-then-answer.json") as unknown[];
  return {
    [ANTHROPIC]: [
      { status: 200, body: pause },
      { status: 200, body: answer },
    ],
    [OPENAI]: [{ status: 200, body: fixture("openai-cited-in-text.json") }],
    [PERPLEXITY]: [{ status: 200, body: fixture("perplexity-named-in-lead.json") }],
  };
}

// Registered once per test file process, at the top level, so it runs after
// every test in a file that imports these helpers.
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface TestDeps extends Deps {
  lines: string[];
  dir: string;
}

export function testDeps(over: Partial<Deps> = {}): TestDeps {
  const dir = mkdtempSync(path.join(tmpdir(), "ai-visibility-test-"));
  made.push(dir);
  const lines: string[] = [];
  const { fetch } = fakeFetch({});
  return {
    root: ROOT,
    resultsDir: path.join(dir, "results"),
    reportFile: path.join(dir, "REPORT.md"),
    env: {},
    fetch,
    now: () => new Date("2026-10-19T01:30:00Z"),
    sleep: async () => {},
    log: (line) => lines.push(line),
    ...over,
    lines,
    dir,
  };
}
