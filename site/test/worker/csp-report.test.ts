import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handle } from "../../worker/routes/csp-report";

const URL_ = "https://coloradostartups.org/api/csp-report";

const report = (blocked: string) =>
  JSON.stringify({
    "csp-report": {
      "effective-directive": "script-src-elem",
      "blocked-uri": blocked,
      "document-uri": "https://coloradostartups.org/team/?ref=abc",
    },
  });

describe("POST /api/csp-report", () => {
  it("stores a normalized, deduplicated violation and answers 204", async () => {
    for (const q of ["a", "b"]) {
      const res = await SELF.fetch(URL_, { method: "POST", body: report(`https://evil.example/x.js?t=${q}`) });
      expect(res.status).toBe(204);
    }
    const row = await env.DB.prepare("SELECT * FROM csp_reports").first<{
      blocked_uri: string;
      document_uri: string;
      count: number;
    }>();
    expect(row?.blocked_uri).toBe("https://evil.example");
    expect(row?.document_uri).toBe("/team/");
    expect(row?.count).toBe(2);
  });

  it("answers 204 on a malformed body", async () => {
    const res = await SELF.fetch(URL_, { method: "POST", body: "{not json" });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/csp-report under load (#170)", () => {
  // A report body that arrives in 1,000-byte chunks, one per pull, with no
  // Content-Length. `pulls` counts how much of it the handler asked for.
  function streamed(text: string, ip: string) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    const seen = { pulls: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        seen.pulls += 1;
        if (offset >= bytes.length) return c.close();
        c.enqueue(bytes.slice(offset, offset + 1000));
        offset += 1000;
      },
      // No read ahead: pull runs only when the handler asks for bytes.
    }, { highWaterMark: 0 });
    const request = new Request(URL_, {
      method: "POST",
      body,
      headers: { "CF-Connecting-IP": ip },
      // @ts-expect-error duplex is required for a streamed request body
      duplex: "half",
    });
    return { request, seen };
  }

  const stored = (blocked: string) =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM csp_reports WHERE blocked_uri = ?").bind(blocked).first<{ n: number }>();

  it("drops a rate-limited report without reading its body", async () => {
    const limited = { ...env, FORM_RATE_LIMIT: { limit: async () => ({ success: false }) } } as unknown as Env;
    const { request, seen } = streamed(report("https://limited.example/x.js"), "198.51.100.20");
    const res = await handle(request, limited);
    expect(res.status).toBe(204);
    expect(seen.pulls).toBe(0);
    expect((await stored("https://limited.example"))?.n).toBe(0);
  });

  it("stops reading a report over 8 KiB and stores nothing", async () => {
    const padded = JSON.stringify({
      "csp-report": {
        "effective-directive": "img-src",
        "blocked-uri": "https://oversized.example/a.png",
        "document-uri": "https://coloradostartups.org/",
        "script-sample": "x".repeat(20_000),
      },
    });
    const { request, seen } = streamed(padded, "198.51.100.21");
    const res = await handle(request, env);
    expect(res.status).toBe(204);
    // 8 KiB is nine 1,000-byte chunks; the reader cancels on the ninth.
    expect(seen.pulls).toBeLessThanOrEqual(10);
    expect((await stored("https://oversized.example"))?.n).toBe(0);
  });

  it("still stores a small streamed report", async () => {
    const { request } = streamed(report("https://small.example/s.js"), "198.51.100.22");
    expect((await handle(request, env)).status).toBe(204);
    expect((await stored("https://small.example"))?.n).toBe(1);
  });
});
