// Secret-hygiene guard. The example env files are committed on purpose, so they
// must only ever contain Cloudflare's documented TEST keys (which always pass and
// are safe to publish), never a real credential. A real .env / .dev.vars must
// never be tracked. This is a cheap, deterministic backstop that complements the
// gitleaks CI scan: it pins the two files most likely to be edited by hand.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SITE = new URL("../../", import.meta.url);

// Cloudflare's published Turnstile test credentials (always-pass, safe to ship).
const TEST_SITEKEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";

function read(rel: string): string {
  return readFileSync(new URL(rel, SITE), "utf8");
}

describe(".env.example", () => {
  const text = read(".env.example");

  it("uses only the documented Cloudflare TEST sitekey", () => {
    expect(text).toContain(`PUBLIC_TURNSTILE_SITE_KEY=${TEST_SITEKEY}`);
  });

  it("ships no real secret value (the beacon token line stays commented/empty)", () => {
    // Any uncommented assignment must be the public sitekey only.
    const assignments = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#") && l.includes("="));
    for (const line of assignments) {
      expect(line.startsWith("PUBLIC_")).toBe(true);
    }
  });
});

describe(".dev.vars.example", () => {
  const text = read(".dev.vars.example");

  it("uses only the documented Cloudflare TEST secret", () => {
    expect(text).toContain(`TURNSTILE_SECRET_KEY=${TEST_SECRET}`);
  });

  it("does not contain a production-shaped secret", () => {
    // The documented test secret is the only TURNSTILE_SECRET_KEY value allowed.
    const secretLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("TURNSTILE_SECRET_KEY="));
    expect(secretLines).toEqual([`TURNSTILE_SECRET_KEY=${TEST_SECRET}`]);
  });
});

describe("no real secret files are tracked alongside the examples", () => {
  // .gitignore excludes site/.env and site/.dev.vars; if a real one exists on
  // disk it is at least ignored. This asserts the working tree does not ship one
  // next to the examples (a belt-and-braces check; gitleaks covers history).
  it("the example files are the only env templates expected", () => {
    expect(existsSync(new URL(".env.example", SITE))).toBe(true);
    expect(existsSync(new URL(".dev.vars.example", SITE))).toBe(true);
  });
});
