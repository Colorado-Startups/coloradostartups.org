// The statewide map drawn at build time: the Colorado outline, the three zones
// in their region colors, the core cities and the zone names. It is what a
// visitor sees with no JavaScript, and before the live map (ColoradoMap's
// MapLibre layer) loads over it. Plot's `geo` mark with a conformal conic
// projection, the usual choice for a state this shape.
import * as Plot from "@observablehq/plot";

import { renderPlot, type ChartText } from "../plot";
import { COLORADO, ZONES, zoneLabelPoint, type LonLat } from "./colorado-geo";
import { REGION_COLORS } from "./map";

/** Twice the signed area of a lon/lat ring: positive when it runs counterclockwise. */
export function signedArea(ring: readonly LonLat[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a;
}

// d3-geo, under Plot, reads winding the opposite way from GeoJSON (RFC 7946):
// an exterior ring must run clockwise, or it fills the whole globe except the
// shape, and the projection fits the globe. data/geo/ keeps RFC order, which
// MapLibre reads; the drawing reverses each counterclockwise ring.
export function clockwise<F extends { geometry: { coordinates: LonLat[][] } }>(feature: F): F {
  const coordinates = feature.geometry.coordinates.map((r) => (signedArea(r) > 0 ? [...r].reverse() : r));
  return { ...feature, geometry: { ...feature.geometry, coordinates } };
}

export const MAP_WIDTH = 640;
export const MAP_HEIGHT = 470;

/** The no-JavaScript statewide map as an SVG string. */
export function coloradoMapSvg(text: ChartText): string {
  const cities = ZONES.features.flatMap((z) => z.properties.cityPoints);
  const labels = ZONES.features.map((z) => {
    const [lon, lat] = zoneLabelPoint(z);
    return { lon, lat, name: z.properties.name };
  });
  const outline = { ...COLORADO, features: COLORADO.features.map(clockwise) };
  const zones = ZONES.features.map(clockwise);
  return renderPlot({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    ariaLabel: text.label,
    ariaDescription: text.description,
    projection: { type: "conic-conformal", parallels: [37.5, 40.5], rotate: [105.55, 0], domain: outline, inset: 12 },
    marks: [
      Plot.geo(outline, { fill: "var(--c-surface)", stroke: "var(--c-border)", strokeWidth: 1.5 }),
      ...zones.map((z) =>
        Plot.geo(z, { fill: REGION_COLORS[z.id], fillOpacity: 0.18, stroke: REGION_COLORS[z.id], strokeWidth: 2.5 }),
      ),
      Plot.dot(cities, { x: "lon", y: "lat", r: 3.5, fill: "var(--c-text)", stroke: "var(--c-ground)", strokeWidth: 1.5 }),
      Plot.text(labels, {
        x: "lon",
        y: "lat",
        text: "name",
        textAnchor: "start",
        fontWeight: 700,
        // Plot reads a fontSize string as a field name unless it looks like "18px",
        // so the token goes in as a constant channel (as lib/regions/map.ts does).
        fontSize: () => "var(--t-step-0)",
        fill: "var(--c-text)",
        stroke: "var(--c-ground)",
        strokeWidth: 4,
        paintOrder: "stroke",
      }),
    ],
  });
}
