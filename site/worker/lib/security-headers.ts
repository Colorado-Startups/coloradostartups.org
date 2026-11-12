// Single source of truth for the site's HTTP security headers. Two consumers
// read this module so the headers cannot disagree:
//   1. worker/index.ts applies them to every Worker response (/api/*).
//   2. public/_headers declares the same set for static pages, which are served
//      straight from assets and never run the Worker (run_worker_first is
//      ["/api/*"]).
// test/unit/security-headers.test.ts asserts public/_headers equals
// renderHeadersFile(), so the two cannot drift.
//
// Why each non-default source is allowed:
//   - https://challenges.cloudflare.com (script, img, connect, frame): the
//     Turnstile widget on every form.
//   - https://static.cloudflareinsights.com (script) and
//     https://cloudflareinsights.com (connect): the Web Analytics beacon.
//   - 'wasm-unsafe-eval' (script): Pagefind's WebAssembly search (Ecosystem
//     Canvas keyword search and the Resourcus fallback).
//   - https://calendar.google.com (frame): the /event-calendar/ embed.
//   - 'unsafe-inline' (style): Astro inlines small stylesheets as <style>
//     blocks, and components such as ArtImage, Portrait and RegionCard set
//     style attributes.
//   - data: (img): Vite inlines small images as data: URIs (astro.config.mjs
//     keeps its default for every asset but scripts), and the footer's ridge
//     mask is an inline SVG.
// script-src stays free of 'unsafe-inline': astro.config.mjs keeps every script
// external, and test/dom/no-inline-scripts.test.ts guards that.

export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://challenges.cloudflare.com",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://calendar.google.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  "report-uri /api/csp-report",
];

export const CSP_VALUE = CSP_DIRECTIVES.join("; ");
export const CSP_HEADER_NAME = "Content-Security-Policy";

// HSTS covers every subdomain: on 2026-11-03 each name in ops/dns/records.md
// that resolves (www, events, scan) answered HTTPS with a valid certificate,
// and the rest have no address. Standing rule: every subdomain serves HTTPS,
// a new one from day one. A rollback does not lift it: browsers that saw
// includeSubDomains keep it for max-age, so subdomains keep serving HTTPS for
// a year after any rollback. No `preload`: listing on hstspreload.org is public
// and slow to undo, so Paul decides it.
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

const STATIC_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Strict-Transport-Security", HSTS_VALUE],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  // Public site: cross-origin lets social previews embed the OG images.
  ["Cross-Origin-Resource-Policy", "cross-origin"],
];

export const ALL_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  [CSP_HEADER_NAME, CSP_VALUE],
  ...STATIC_SECURITY_HEADERS,
];

// Sets every header in ALL_SECURITY_HEADERS on `headers`, replacing any value
// already there, and returns the same object.
export function applySecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of ALL_SECURITY_HEADERS) headers.set(name, value);
  return headers;
}

// Headers for one static file, added on top of the /* rule. The Startup
// Resources JSON names its license the way RFC 8288 lets a client read it
// without parsing the body. The URL must equal LICENSE.url in
// src/lib/data/license.ts; test/unit/security-headers.test.ts checks that.
export const PATH_HEADERS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ["/data/resources.json", [["Link", '<https://creativecommons.org/licenses/by/4.0/>; rel="license"']]],
];

// The text of public/_headers: the security headers under /*, then each
// PATH_HEADERS rule.
export function renderHeadersFile(): string {
  const lines = [
    "# Generated to match worker/lib/security-headers.ts.",
    "# Keep in sync; the parity test in test/unit/security-headers.test.ts enforces it.",
    "/*",
  ];
  for (const [name, value] of ALL_SECURITY_HEADERS) lines.push(`  ${name}: ${value}`);
  for (const [path, headers] of PATH_HEADERS) {
    lines.push(path);
    for (const [name, value] of headers) lines.push(`  ${name}: ${value}`);
  }
  return lines.join("\n") + "\n";
}
