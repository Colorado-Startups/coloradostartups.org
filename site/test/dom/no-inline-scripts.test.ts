import { describe, expect, it } from "vitest";

import { builtPages } from "./pages";

// Guards the enforced Content-Security-Policy `script-src 'self'` (no
// 'unsafe-inline'; see worker/lib/security-headers.ts). An inline <script> with
// a body is blocked by that policy, which would silently break the affected
// island (the Resourcus panel, the header nav toggle, the form helpers). Astro inlines
// small single-page hoisted scripts by
// default; astro.config.mjs sets assetsInlineLimit to force them external, and
// this test fails the build if any inline executable script ever slips back in.

const pages = builtPages();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

// A <script> is subject to script-src only when it is an executable classic or
// module script. Data blocks (JSON-LD, import maps, etc.) are not executed and
// not covered by script-src, so they are allowed to be inline.
const EXECUTABLE_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

function inlineExecutableScripts(doc: Document): HTMLScriptElement[] {
  return Array.from(doc.querySelectorAll("script")).filter((el) => {
    if (el.hasAttribute("src")) return false; // external: covered by 'self'/named hosts
    if (!EXECUTABLE_TYPES.has((el.getAttribute("type") ?? "").toLowerCase())) return false;
    return el.textContent != null && el.textContent.trim().length > 0;
  });
}

describe("no inline executable scripts in the built HTML", () => {
  it.each(pages.map((p) => [p.route, p] as const))(
    "%s ships every script as an external file (strict script-src 'self')",
    (route, page) => {
      const offenders = inlineExecutableScripts(parse(page.html)).map(
        (el) => `<script${el.getAttribute("type") ? ` type="${el.getAttribute("type")}"` : ""}>` +
          `${el.textContent!.trim().slice(0, 60)}...`,
      );
      expect(
        offenders,
        `${route} has inline <script> bodies that the strict script-src 'self' CSP will block. ` +
          `Astro should externalize hoisted scripts; check astro.config.mjs assetsInlineLimit.`,
      ).toEqual([]);
    },
  );
});
