// The network guard in msw.ts and net-guard.ts: a test reaches loopback and
// its own handlers, nothing else. A blocked request rejects like a network
// error and is recorded, so the test fails even when the code under test
// swallows the rejection (#614, #660).

import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyTurnstile } from "../../worker/lib/turnstile";
import { assertNothingBlocked, blocked, isLoopbackHost } from "./net-guard";
import { server } from "./server";

afterEach(() => vi.restoreAllMocks());

describe("the network guard", () => {
  it.each([
    "https://challenges.cloudflare.com/x",
    "https://api.kit.com/x",
    "https://hooks.slack.com/x",
    "https://api.convertkit.com/x", // a third party no list named
    "https://api.anthropic.com/v1/messages", // an LLM API
    "https://api.kit.com./x", // trailing dot
    "https://API.KIT.COM/x",
    "https://coloradostartups.org/api/health", // the live site
  ])("blocks %s", async (url) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await fetch(url, { method: "POST", body: "x" }).then(
      () => null,
      (e: unknown) => e,
    );
    // The network-error TypeError, caused by the guard's own Response.error():
    // the interceptor answered, so no real request went out. A real DNS or
    // connection failure is a TypeError with no Response as its cause.
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).cause).toBeInstanceOf(Response);
    expect(((err as TypeError).cause as Response).type).toBe("error");
    expect(blocked.splice(0)).toHaveLength(1);
  });

  it("records a blocked request the code under test swallowed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // verifyTurnstile catches the rejection and returns false (fails closed).
    expect(await verifyTurnstile("token", "secret", null)).toBe(false);
    expect(blocked.splice(0)).toEqual(["POST https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
  });

  it("fails the test after it ends when anything was blocked, then starts clean", () => {
    blocked.push("GET https://example.org/");
    expect(() => assertNothingBlocked()).toThrow(/example\.org/);
    expect(blocked).toEqual([]);
    expect(() => assertNothingBlocked()).not.toThrow();
  });

  it("lets a mocked request through to its handler", async () => {
    server.use(http.post("https://api.kit.com/v4/subscribers", () => HttpResponse.json({ ok: true })));
    const res = await fetch("https://api.kit.com/v4/subscribers", { method: "POST" });
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each(["localhost", "LOCALHOST.", "127.0.0.1", "[::1]", "pool.localhost"])("allows loopback %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["localhost.evil.example", "127.0.0.1.evil.example", "notlocalhost", "10.0.0.1"])(
    "does not take %s for loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
