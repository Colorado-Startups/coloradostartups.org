// The statewide map drawn at build time: the Colorado outline, the three zones
// in their region colors, the core cities and the zone names. It is what a
// visitor sees with no JavaScript, and before the live map (ColoradoMap's
// MapLibre layer) loads over it. Plot's `geo` mark with a conformal conic
// projection, the usual choice for a state this shape.
import * as Plot from "@observablehq/plot";

import { renderPlot, type ChartText } from "../plot";
import { COLORADO, ZONES, zoneLabelPoint } from "./colorado-geo";
import { REGION_COLORS } from "./map";

export const MAP_WIDTH = 640;
export const MAP_HEIGHT = 470;

/** The no-JavaScript statewide map as an SVG string. */
export function coloradoMapSvg(text: ChartText): string {
  const cities = ZONES.features.flatMap((z) => z.properties.cityPoints);
  const labels = ZONES.features.map((z) => {
    const [lon, lat] = zoneLabelPoint(z);
    return { lon, lat, name: z.properties.name };
  });
  return renderPlot({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    ariaLabel: text.label,
    ariaDescription: text.description,
    projection: { type: "conic-conformal", parallels: [37.5, 40.5], rotate: [105.55, 0], domain: COLORADO, inset: 12 },
    marks: [
      Plot.geo(COLORADO, { fill: "var(--c-surface)", stroke: "var(--c-border)", strokeWidth: 1.5 }),
      ...ZONES.features.map((z) =>
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
