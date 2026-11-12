import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  honeypotTripped,
  makeSafeReturnTo,
  readBodyCapped,
  readFormCapped,
  redirect,
  submittedTooFast,
} from "../../worker/lib/forms";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe("submittedTooFast", () => {
  const now = 1_800_000_000_000;
  it("fails a missing stamp (the sibling site skipped this case)", () => {
    expect(submittedTooFast(form({}), now)).toBe(true);
  });
  it("fails a malformed or future stamp", () => {
    expect(submittedTooFast(form({ ts: "abc" }), now)).toBe(true);
    expect(submittedTooFast(form({ ts: String(now + 1000) }), now)).toBe(true);
  });
  it("fails a post under three seconds and passes a slower one", () => {
    expect(submittedTooFast(form({ ts: String(now - 1000) }), now)).toBe(true);
    expect(submittedTooFast(form({ ts: String(now - 5000) }), now)).toBe(false);
  });
});

describe("honeypotTripped", () => {
  it("is true only when the hidden field has content", () => {
    expect(honeypotTripped(form({ website: "spam" }))).toBe(true);
    expect(honeypotTripped(form({}))).toBe(false);
  });
});

describe("makeSafeReturnTo", () => {
  const safe = makeSafeReturnTo(["/leaderboard/", "/"], "/");
  it("reflects only allowlisted paths", () => {
    expect(safe("/leaderboard/")).toBe("/leaderboard/");
    expect(safe("https://evil.example/")).toBe("/");
    expect(safe("//evil.example/")).toBe("/");
    expect(safe(null)).toBe("/");
  });
});

describe("redirect", () => {
  it("builds a same-origin 303 with a fixed error code", () => {
    const res = redirect(new URL("https://coloradostartups.org/api/nominate"), "/leaderboard/", "invalid");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://coloradostartups.org/leaderboard/?error=invalid");
  });
});

describe("readFormCapped", () => {
  const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
  // A stream with no Content-Length, the way a chunked request arrives.
  function chunked(text: string): Request {
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.slice(i, i + 1000));
        c.close();
      },
    });
    return new Request("https://example.org/api/x", { method: "POST", headers: FORM, body, duplex: "half" } as RequestInit);
  }

  it("parses a body under the cap", async () => {
    const form = await readFormCapped(chunked("a=1&b=two"), 100);
    expect(form?.get("b")).toBe("two");
  });

  it("rejects a chunked body over the cap with no Content-Length", async () => {
    const req = chunked(`a=${"x".repeat(5000)}`);
    expect(req.headers.get("Content-Length")).toBeNull();
    expect(await readFormCapped(req, 4096)).toBeNull();
  });

  it("accepts exactly the cap and rejects one byte more", async () => {
    expect(await readFormCapped(chunked(`a=${"x".repeat(98)}`), 100)).not.toBeNull();
    expect(await readFormCapped(chunked(`a=${"x".repeat(99)}`), 100)).toBeNull();
  });

  it("counts a plain, non-chunked body against the same cap", async () => {
    const plain = (n: number) =>
      new Request("https://example.org/api/x", { method: "POST", headers: FORM, body: `a=${"y".repeat(n - 2)}` });
    expect((await readFormCapped(plain(8192), 8192))?.get("a")).toHaveLength(8190);
    expect(await readFormCapped(plain(8193), 8192)).toBeNull();
  });

  it("rejects a declared Content-Length over the cap before reading", async () => {
    const req = new Request("https://example.org/api/x", {
      method: "POST",
      headers: { ...FORM, "Content-Length": "999999" },
      body: "a=1",
    });
    expect(await readFormCapped(req, 100)).toBeNull();
  });
});

describe("readBodyCapped", () => {
  it("returns the bytes under the cap and null one byte over", async () => {
    const req = (n: number) => new Request("https://example.org/api/x", { method: "POST", body: "y".repeat(n) });
    expect((await readBodyCapped(req(8192), 8192))?.byteLength).toBe(8192);
    expect(await readBodyCapped(req(8193), 8192)).toBeNull();
  });

  // #316: an upload that breaks off mid-read is an invalid request, not a
  // Worker failure, so every form route answers its own ?error=invalid.
  it("returns null, not a throw, when the body stream errors mid-read", async () => {
    const broken = () =>
      new Request("https://example.org/api/x", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode("a=1&b="));
            c.error(new Error("connection reset"));
          },
        }),
        duplex: "half",
      } as RequestInit);
    expect(await readBodyCapped(broken(), 8192)).toBeNull();
    expect(await readFormCapped(broken(), 8192)).toBeNull();
  });

  it("returns no bytes for a request with no body", async () => {
    expect((await readBodyCapped(new Request("https://example.org/api/x", { method: "POST" }), 10))?.byteLength).toBe(0);
  });
});

// Decision 35 and #170: a body read straight off the request skips the cap.
describe("every Worker body read goes through the cap", () => {
  const WORKER = new URL("../../worker/", import.meta.url);
  const files = readdirSync(WORKER, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
  const DIRECT_READ = /\brequest\.(?:text|json|formData|arrayBuffer|blob)\(/;
  // Code only: a comment that names the rule is not a call.
  const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("catches a direct read and ignores a comment that names one", () => {
    expect(codeOf("const body = await request.text();")).toMatch(DIRECT_READ);
    expect(codeOf("// never request.formData() directly")).not.toMatch(DIRECT_READ);
    expect(files).toContain("routes/csp-report.ts");
  });

  it.each(files)("%s never calls request.text(), .json() or .formData()", (file) => {
    expect(codeOf(readFileSync(new URL(file, WORKER), "utf8"))).not.toMatch(DIRECT_READ);
  });
});
