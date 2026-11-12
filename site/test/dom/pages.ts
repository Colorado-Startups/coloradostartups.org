import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// site/ root and the built output. These tests run against dist/, so they
// require a prior `npm run build` (the test:content script does that).
export const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIST_DIR = path.join(SITE_DIR, "dist");

export interface BuiltPage {
  /** Public route, e.g. "/", "/team/", "/newsletter/thanks/", "/404.html". */
  route: string;
  /** Absolute path to the built .html file. */
  file: string;
  /** Raw file contents. */
  html: string;
  /**
   * True for Astro redirect stubs (e.g. /pledges/ -> /team/): a minimal
   * meta-refresh page, not a BaseLayout page, so it is exempt from the per-page
   * structural/a11y/footer contracts. Use contentPages() to skip them.
   */
  isRedirect: boolean;
}

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

export function builtPages(): BuiltPage[] {
  if (!existsSync(DIST_DIR)) {
    throw new Error(
      `dist/ not found at ${DIST_DIR}. Run "npm run build" first (the test:content script does this).`,
    );
  }
  return walkHtml(DIST_DIR)
    .map((file) => {
      const rel = path.relative(DIST_DIR, file).split(path.sep).join("/");
      let route: string;
      if (rel === "index.html") route = "/";
      else if (rel.endsWith("/index.html")) route = "/" + rel.slice(0, -"index.html".length);
      else route = "/" + rel; // e.g. /404.html
      const html = readFileSync(file, "utf8");
      const isRedirect = /<meta[^>]+http-equiv=["']?refresh["']?/i.test(html);
      return { route, file, html, isRedirect };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

/** Built pages minus redirect stubs: the full BaseLayout pages tests assert on. */
export function contentPages(): BuiltPage[] {
  return builtPages().filter((p) => !p.isRedirect);
}

export function readDist(relativePath: string): string {
  return readFileSync(path.join(DIST_DIR, relativePath), "utf8");
}

/** Sitemap URLs as site-root-relative paths, e.g. "/", "/team/". */
export function sitemapPaths(): string[] {
  const xml = readDist("sitemap-0.xml");
  const locs = xml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
  return locs.map((loc) =>
    loc
      .replace(/<\/?loc>/g, "")
      .replace("https://coloradostartups.org", "")
      .trim(),
  );
}
