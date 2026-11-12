// The pure helpers in worker/lib that the form routes and the CSP sink share.
// They import nothing from the Workers runtime, so they run in plain Node.

import { describe, expect, it } from "vitest";

import { normalizeBlockedUri, normalizeDirective, normalizeDocumentPath, parseCspReport } from "../../worker/lib/csp";
import { isPlausibleEmail, singleLine } from "../../worker/lib/validate";

describe("parseCspReport", () => {
  it("normalizes a report to a directive, an origin and a path", () => {
    const v = parseCspReport({
      "csp-report": {
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src 'self'",
        "blocked-uri": "https://evil.example/a.js?token=secret",
        "document-uri": "https://coloradostartups.org/team/?ref=abc#x",
      },
    });
    expect(v).toEqual({
      directive: "script-src-elem",
      blockedUri: "https://evil.example",
      documentUri: "/team/",
      signature: "script-src-elem|https://evil.example|/team/",
    });
  });

  it("gives two reports that differ only in query string one signature", () => {
    const report = (q: string) =>
      parseCspReport({
        "csp-report": {
          "effective-directive": "img-src",
          "blocked-uri": `https://evil.example/a.png?${q}`,
          "document-uri": `https://coloradostartups.org/team/?${q}`,
        },
      });
    expect(report("t=1")?.signature).toBe(report("t=2")?.signature);
  });

  it("rejects anything that is not a report", () => {
    for (const body of [null, "x", 1, {}, { "csp-report": "x" }, { "csp-report": {} }]) {
      expect(parseCspReport(body)).toBeNull();
    }
  });

  it("keeps keywords, caps long values and falls back on empty ones", () => {
    expect(normalizeBlockedUri("INLINE")).toBe("inline");
    expect(normalizeBlockedUri("")).toBe("(empty)");
    expect(normalizeBlockedUri("x".repeat(500))).toHaveLength(200);
    expect(normalizeDocumentPath("not a url?q=1")).toBe("not a url");
    expect(normalizeDirective("  Img-Src  'self' ")).toBe("img-src");
  });
});

describe("singleLine and isPlausibleEmail", () => {
  it("turns CR and LF runs into one space and trims", () => {
    expect(singleLine(" a\r\n\r\nb\nc ")).toBe("a b c");
  });

  it("accepts a plain address and refuses the obvious non-addresses", () => {
    expect(isPlausibleEmail("reader@example.org")).toBe(true);
    for (const bad of ["reader", "reader@example", "a b@example.org", "reader@example.o"]) {
      expect(isPlausibleEmail(bad)).toBe(false);
    }
  });
});
