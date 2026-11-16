// A map as one standalone SVG file: the relief image, the wash under it and
// the drawing, with every token resolved to its light-theme value. A README on
// GitHub, or any page that cannot run the site's CSS, shows it with an <img>.
// Served at /maps/colorado.svg and /maps/<region>.svg (pages/maps/[view].svg.ts).
import type { RegionId } from "@cs/shared";
import { parse } from "yaml";

import { ZONES, zoneById } from "./colorado-geo";
import { coloradoMapSvg, NAME_PX, SMALL_PX, viewOf } from "./colorado-map";

const reliefs = import.meta.glob<string>("../../assets/maps/relief-*.jpg", { query: "?inline", import: "default", eager: true });

// The light theme's colors, from the one token source (styles/tokens.css is generated from it).
const tokenFile = import.meta.glob<string>("../../../../01_doctrine/brand_tokens.yaml", { query: "?raw", import: "default", eager: true });
const COLORS = (parse(Object.values(tokenFile)[0] ?? "") as { color?: Record<string, string> } | null)?.color ?? {};
// The two type steps the drawing uses (styles/tokens.css), as the px the drawing's own layout assumes.
const TYPE: Readonly<Record<string, string>> = { "--t-step-0": `${NAME_PX}px`, "--t-step--1": `${SMALL_PX}px` };

/**
 * A CSS custom property's light-theme value: a type step in px, or a color,
 * where `--c-text` is `color.text` in brand_tokens.yaml. A color must be a
 * six-digit hex: `mix` reads nothing else, and anything else would reach the
 * file as a broken color with no error.
 */
function token(name: string): string {
  if (TYPE[name]) return TYPE[name];
  const value: unknown = COLORS[name.replace(/^--c-/, "")];
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`01_doctrine/brand_tokens.yaml has no six-digit hex for ${name} in its light theme (found ${JSON.stringify(value)})`);
  }
  return value;
}

/** Two hex colors mixed in sRGB: `share` of the first, the rest of the second. */
function mix(a: string, b: string, share: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v * share + y[i]! * (1 - share)).toString(16).padStart(2, "0")).join("")}`;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** The statewide map, or one region's, as a standalone SVG string. */
export function mapFileSvg(zone?: RegionId): string {
  const { id, frame } = viewOf({ zone });
  const relief = reliefs[`../../assets/maps/relief-${id}.jpg`];
  if (!relief) throw new Error(`site/src/assets/maps/relief-${id}.jpg is missing; run node scripts/geo/views.mjs`);
  const label = zone ? `Map of ${zoneById(zone).properties.name}, a Colorado Startups region` : "Map of Colorado with the three Colorado Startups regions";
  const description = zone
    ? `${zoneById(zone).properties.name} follows ${zoneById(zone).properties.roads.join(", ")}.`
    : ZONES.features.map((z) => `${z.properties.name}: ${z.properties.cities.join(", ")}.`).join(" ");
  const drawing = coloradoMapSvg({ label, description }, { zone }).replace(/var\((--[\w-]+)\)/g, (_, name: string) => token(name));
  const [surface, community, accent, dim, ground] = ["--c-surface", "--c-community", "--c-accent", "--c-text-dim", "--c-ground"].map(token) as [string, string, string, string, string];
  const { width: w, height: h } = frame;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escape(label)}">`,
    `<title>${escape(label)}</title><desc>${escape(description)}</desc>`,
    // Mountains west, plains east: the same cool-to-warm wash the site's map box paints.
    `<defs><linearGradient id="wash" x1="0" x2="1" y1="0" y2="0">`,
    `<stop offset="0" stop-color="${mix(community, surface, 0.46)}"/><stop offset="0.46" stop-color="${mix(community, surface, 0.14)}"/><stop offset="1" stop-color="${mix(accent, surface, 0.34)}"/>`,
    `</linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#wash)"/>`,
    `<image href="${relief}" width="${w}" height="${h}" preserveAspectRatio="none" style="mix-blend-mode:overlay;filter:contrast(1.35) brightness(0.86)"/>`,
    drawing,
    `<text x="${w - 8}" y="${h - 8}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" fill="${dim}" stroke="${ground}" stroke-width="3" paint-order="stroke">Roads: US Census Bureau · Relief: USGS · coloradostartups.org</text>`,
    `</svg>`,
  ].join("");
}
