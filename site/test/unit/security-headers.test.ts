import { RESOURCES_JSON_PATH } from "@cs/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LICENSE } from "../../src/lib/data/license";
import {
  ALL_SECURITY_HEADERS,
  CSP_DIRECTIVES,
  CSP_HEADER_NAME,
  CSP_VALUE,
  HSTS_VALUE,
  PATH_HEADERS,
  renderHeadersFile,
} from "../../worker/lib/security-headers";

const HEADERS_FILE = new URL("../../public/_headers", import.meta.url);

// Parse the catch-all (/*) rule of a Cloudflare _headers file into a
// name -> value map. Header lines are indented; the rule line ("/*") is not.
function parseHeadersFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inRule = false;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("#") || raw.trim() === "") continue;
    if (!raw.startsWith(" ")) {
      inRule = raw.trim() === "/*";
      continue;
    }
    if (!inRule) continue;
    const line = raw.trim();
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

describe("security-headers module", () => {
  it("enforces the CSP (Content-Security-Policy, not Report-Only)", () => {
    expect(CSP_HEADER_NAME).toBe("Content-Security-Policy");
  });

  it("keeps script-src strict (no 'unsafe-inline')", () => {
    const scriptSrc = CSP_DIRECTIVES.find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it.each([
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
  ])("declares the %s directive", (directive) => {
    expect(CSP_DIRECTIVES).toContain(directive);
  });

  it.each([
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
  ])("includes the %s header", (name) => {
    expect(ALL_SECURITY_HEADERS.some(([n]) => n === name)).toBe(true);
  });

  // includeSubDomains: every resolving subdomain serves HTTPS (ops/dns/records.md,
  // checked 2026-11-03). preload stays out until Paul decides: the
  // hstspreload.org list is public and slow to undo.
  it("sends a year of HSTS over every subdomain, without preload", () => {
    const hsts = ALL_SECURITY_HEADERS.find(([n]) => n === "Strict-Transport-Security")?.[1];
    expect(hsts).toBe(HSTS_VALUE);
    expect(hsts?.split(";").map((d) => d.trim())).toEqual(["max-age=31536000", "includeSubDomains"]);
    expect(hsts).not.toMatch(/preload/i);
  });
});

describe("public/_headers parity", () => {
  it("matches the module's rendered output exactly", () => {
    const onDisk = readFileSync(HEADERS_FILE, "utf8");
    expect(onDisk).toBe(renderHeadersFile());
  });

  it("declares the same name/value set the Worker applies (no drift)", () => {
    const parsed = parseHeadersFile(readFileSync(HEADERS_FILE, "utf8"));
    const expected: Record<string, string> = Object.fromEntries(
      ALL_SECURITY_HEADERS.map(([n, v]) => [n, v]),
    );
    expect(parsed).toEqual(expected);
    // The CSP value round-trips through the file unchanged.
    expect(parsed[CSP_HEADER_NAME]).toBe(CSP_VALUE);
  });
});

describe("the Startup Resources license header", () => {
  const rule = PATH_HEADERS.find(([path]) => path === RESOURCES_JSON_PATH);

  it("names the file /data/resources.json actually serves", () => {
    expect(rule).toBeDefined();
  });

  it("links the same license the /data/ page states", () => {
    const link = rule?.[1].find(([name]) => name === "Link")?.[1];
    expect(link).toBe(`<${LICENSE.url}>; rel="license"`);
  });
});
