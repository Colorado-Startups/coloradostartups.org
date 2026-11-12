// @ts-check
// Orchestrator-owned. Lanes request changes.
import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";

import { dataDates, lastmodSerializer } from "./src/lib/seo/lastmod.mjs";

// Keep every hoisted <script> as an external /_astro/*.js file. The enforced
// CSP is `script-src 'self'` with no 'unsafe-inline' (worker/lib/
// security-headers.ts), so an inlined script would be blocked in the browser.
// Returning undefined for non-JS assets keeps Vite's default inlining for them.
const assetsInlineLimit = (/** @type {string} */ filePath) =>
  filePath.endsWith(".js") ? false : undefined;

// Review-only and thank-you pages stay out of the sitemap.
const SITEMAP_EXCLUDE = /\/(styleguide|thanks)\//;

export default defineConfig({
  site: "https://coloradostartups.org",
  output: "static",
  trailingSlash: "always",
  // Path redirects live in public/_redirects (owned by L6), not here: Astro's
  // static redirects emit meta-refresh pages, and the Workers static-asset
  // _redirects file returns real 301s.
  // `astro dev` serves on 3303, in this Mac account's port block, never on
  // Astro's vendor default 4321 (managed Mac policy, Ports). strictPort makes
  // a taken port exit instead of moving to the next one. Astro merges `vite`
  // under its own server block, which sets no strictPort, so this one holds.
  // `npm run dev -- --port <n>` still overrides the port for a second session.
  server: { port: 3303 },
  // Astro's sharp service, plus each art file's provenance XMP in every
  // variant it makes (src/lib/image/provenance-service.mjs).
  image: { service: { entrypoint: "./src/lib/image/provenance-service.mjs" } },
  vite: {
    build: { assetsInlineLimit },
    server: { strictPort: true },
  },
  // lastmod comes from each page's own data date and never from the build
  // time; pages with no data date get none (src/lib/seo/lastmod.mjs).
  integrations: [
    sitemap({
      filter: (page) => !SITEMAP_EXCLUDE.test(page),
      serialize: lastmodSerializer(dataDates()),
    }),
  ],
  // Self-hosted at build time by the Astro Fonts API. Both are OFL.
  // Display: Cinzel, all caps by design, headings only. Body: Alegreya Sans.
  // Cinzel 800 is the chunky carved weight for h1 and banners (L12, decided
  // 2026-10-18). Google serves Cinzel as one variable file, so it adds no file.
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Cinzel",
      cssVariable: "--font-display",
      weights: [600, 700, 800],
      styles: ["normal"],
      // The Liberation face (fonts.css) is size-matched for Linux.
      fallbacks: ["Cinzel Fallback Liberation", "Georgia", "Cambria", "serif"],
    },
    {
      provider: fontProviders.google(),
      name: "Alegreya Sans",
      cssVariable: "--font-body",
      weights: [400, 500, 700],
      styles: ["normal", "italic"],
      // Astro's own fallback measured the italic file and drew upright text
      // 9 to 11 percent narrow (#762); fonts.css sizes the Arial, Liberation,
      // Arimo and Roboto fallbacks from the upright files instead.
      optimizedFallbacks: false,
      fallbacks: ["Alegreya Sans Fallback Arial", "Alegreya Sans Fallback Roboto", "system-ui", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
    },
  ],
});
