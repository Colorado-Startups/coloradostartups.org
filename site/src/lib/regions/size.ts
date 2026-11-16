// A region's size against Silicon Valley's: the two loops as silhouettes at
// one scale, side by side. Paul's rule (2026-11-15) is that each region is
// about the size of Silicon Valley; this is the picture of it. Both loops are
// traced from US Census road lines (scripts/geo/build.mjs).
import type { RegionId } from "@cs/shared";

import { zoneById, type LonLat } from "./colorado-geo";
import { YARDSTICK } from "./colorado-views";
import { REGION_COLORS } from "./map";

const WIDTH = 240;
const HEIGHT = 112;
const PAD = 8;
const GAP = 28;
const LABEL = 20; // room under each shape for its name

/** A ring in miles from the middle of its own box, y down as SVG draws it. */
function inMiles(ring: readonly LonLat[]): { points: [number, number][]; w: number; h: number } {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const [lon0, lat0] = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const perLon = 69.172 * Math.cos((lat0 * Math.PI) / 180);
  const points = ring.map(([lon, lat]): [number, number] => [(lon - lon0) * perLon, (lat0 - lat) * 68.71]);
  return { points, w: (Math.max(...lons) - Math.min(...lons)) * perLon, h: (Math.max(...lats) - Math.min(...lats)) * 68.71 };
}

const path = (points: readonly [number, number][], k: number, cx: number, cy: number) =>
  `M${points.map(([x, y]) => `${(cx + x * k).toFixed(1)},${(cy + y * k).toFixed(1)}`).join("L")}Z`;

/** The region's loop and Silicon Valley's at the same scale, as one labelled SVG image. */
export function sizeSvg(id: RegionId): string {
  const zone = zoneById(id);
  const a = inMiles(zone.geometry.coordinates[0]!);
  const b = inMiles(YARDSTICK.ring);
  const k = Math.min((WIDTH - 2 * PAD - GAP) / (a.w + b.w), (HEIGHT - 2 * PAD - LABEL) / Math.max(a.h, b.h));
  const cy = PAD + (HEIGHT - 2 * PAD - LABEL) / 2;
  const left = (WIDTH - (a.w + b.w) * k - GAP) / 2;
  const [ax, bx] = [left + (a.w * k) / 2, left + a.w * k + GAP + (b.w * k) / 2];
  const color = REGION_COLORS[id];
  const name = (x: number, text: string) =>
    `<text x="${x.toFixed(1)}" y="${HEIGHT - PAD}" text-anchor="middle" fill="var(--c-text-dim)" font-size="12" font-weight="700">${text}</text>`;
  return [
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${zone.properties.name}'s loop beside ${YARDSTICK.name}'s, at the same scale">`,
    `<path d="${path(a.points, k, ax, cy)}" fill="${color}" fill-opacity="0.18" stroke="var(--c-night)" stroke-opacity="0.6" stroke-width="4" stroke-linejoin="round"/>`,
    `<path d="${path(a.points, k, ax, cy)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<path d="${path(b.points, k, bx, cy)}" fill="none" stroke="var(--c-text-dim)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linejoin="round"/>`,
    name(ax, zone.properties.name),
    name(bx, YARDSTICK.name),
    "</svg>",
  ].join("");
}
