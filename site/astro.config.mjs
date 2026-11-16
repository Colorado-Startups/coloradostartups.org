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

// Review-only and thank-you pages stay out of the sitemap. /join/slack/ stays
// out until step P5b links it (it is noindex until then too).
const SITEMAP_EXCLUDE = /\/(styleguide|thanks|join\/slack)\//;

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
  // Self-hosted at build time by the Astro Fonts API.
  // Brand v3.1 type (Colorado-Startups/brand dist/brand.json `type` roles):
  // Aileron is the display face (CC0); Atkinson Hyperlegible, the State of
  // Colorado's recommended web body face, sets body text (SIL OFL 1.1). Both
  // are self-hosted through Fontsource, and Astro sizes each one's Arial
  // fallback from the font's own metrics, so the swap moves little.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Aileron",
      cssVariable: "--font-display",
      weights: [400, 700, 800],
      styles: ["normal"],
      fallbacks: ["Arial", "sans-serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Atkinson Hyperlegible",
      cssVariable: "--font-body",
      weights: [400, 700],
      styles: ["normal", "italic"],
      fallbacks: ["Arial", "sans-serif"],
    },
  ],
});
