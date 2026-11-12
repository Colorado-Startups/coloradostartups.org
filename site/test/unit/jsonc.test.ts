import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseJsonc } from "../jsonc.mjs";

// Samples for the shared JSONC reader (issue #365).
describe("parseJsonc", () => {
  it("drops line and block comments", () => {
    const text = [
      "{",
      "  // a line comment",
      '  "a": 1, /* a block comment */ "b": /* inline */ 2',
      "  /* a block comment",
      "     over two lines */",
      "} // a comment with no newline after it",
    ].join("\n");
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  it("drops trailing commas in arrays and objects", () => {
    expect(parseJsonc('{ "a": [1, 2, ], "b": { "c": 3, }, }')).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it("drops a trailing comma followed by a comment before the bracket", () => {
    const text = [
      "{",
      '  "list": [',
      "    1,",
      "    2, // the last one",
      "  ],",
      '  "obj": { "k": "v", /* a note */ },',
      "}",
    ].join("\n");
    expect(parseJsonc(text)).toEqual({ list: [1, 2], obj: { k: "v" } });
  });

  it("keeps comment markers and bracket commas inside strings", () => {
    const text = '{ "route": "/api/*", "url": "https://example.com//x", "c": "/* kept */", "d": "a, ]", "e": ",}" }';
    expect(parseJsonc(text)).toEqual({
      route: "/api/*",
      url: "https://example.com//x",
      c: "/* kept */",
      d: "a, ]",
      e: ",}",
    });
  });

  it("keeps an escaped quote inside a string", () => {
    const text = String.raw`{ "q": "say \"hi\" // still the string", "tail": "ends in a backslash\\", "n": 1, }`;
    expect(parseJsonc(text)).toEqual({ q: 'say "hi" // still the string', tail: "ends in a backslash\\", n: 1 });
  });

  it("throws on an unclosed block comment", () => {
    expect(() => parseJsonc('{\n  "a": 1 /* never closed\n}')).toThrow(/unclosed \/\* comment opened on line 2/);
  });

  it("parses the real site/wrangler.jsonc", () => {
    const config = parseJsonc(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")) as {
      assets: { run_worker_first: string[] };
      ratelimits: { name: string; simple: { limit: number } }[];
    };
    expect(config.assets.run_worker_first).toEqual(["/api/*"]);
    // The top-level FORM_RATE_LIMIT in wrangler.jsonc allows 10 posts per 60 s.
    expect(config.ratelimits.find((r) => r.name === "FORM_RATE_LIMIT")?.simple.limit).toBe(10);
  });
});
