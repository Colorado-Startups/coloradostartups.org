// The statewide map drawn at build time: the Colorado outline, the three zones
// in their region colors, the core cities and the zone names. It is what a
// visitor sees with no JavaScript, and before the live map (ColoradoMap's
// MapLibre layer) loads over it. Plot's `geo` mark with a conformal conic
// projection, the usual choice for a state this shape.
//
// With a `zone`, the drawing is that zone's view, as the live map's is: the
// projection fits the zone and centres on it, the other two zones dim, and the
// zone's core cities carry their names, since no basemap names them.
import * as Plot from "@observablehq/plot";

import type { RegionId } from "@cs/shared";

import { renderPlot, type ChartText } from "../plot";
import { COLORADO, DIM, ZONES, zoneBounds, zoneLabelPoint, type LonLat } from "./colorado-geo";
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

/** The statewide drawing's central meridian, as a [west, east] pair of one point. */
const STATE_CENTRE: [LonLat, LonLat] = [
  [-105.55, 0],
  [-105.55, 0],
];

export interface MapView {
  /** Zoom to one zone and dim the other two. Omit for the whole state. */
  zone?: RegionId;
}

/** The no-JavaScript statewide map, or one zone's view of it, as an SVG string. */
export function coloradoMapSvg(text: ChartText, { zone }: MapView = {}): string {
  const outline = { ...COLORADO, features: COLORADO.features.map(clockwise) };
  const zones = ZONES.features.map(clockwise);
  const focus = zones.find((z) => z.id === zone);
  // The statewide map dots every core city and names the zones; a zone's view
  // dots and names only that zone's cities.
  const cities = (focus ? [focus] : ZONES.features).flatMap((z) => z.properties.cityPoints);
  const labels = focus
    ? cities
    : ZONES.features.map((z) => {
        const [lon, lat] = zoneLabelPoint(z);
        return { lon, lat, name: z.properties.name };
      });
  const [[west], [east]] = focus ? zoneBounds(focus.id) : STATE_CENTRE;
  const lit = (id: RegionId) => !focus || focus.id === id;
  // A zone's view names its cities; a city within 0.15° of the zone's east
  // edge (Greeley, Colorado Springs) takes its name above it, on the west
  // side, or the name runs past the frame.
  const eastSide = (p: { lon: number }) => !focus || p.lon < east - 0.15;
  return renderPlot({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    ariaLabel: text.label,
    ariaDescription: text.description,
    projection: {
      type: "conic-conformal",
      parallels: [37.5, 40.5],
      rotate: [-(west + east) / 2, 0],
      domain: focus ?? outline,
      inset: focus ? 32 : 12,
    },
    marks: [
      Plot.geo(outline, { fill: "var(--c-surface)", stroke: "var(--c-border)", strokeWidth: 1.5, clip: "frame" }),
      // The focused zone last, so its line draws over its neighbours'.
      ...[...zones.filter((z) => !lit(z.id)), ...zones.filter((z) => lit(z.id))].map((z) =>
        Plot.geo(z, {
          fill: REGION_COLORS[z.id],
          fillOpacity: lit(z.id) ? 0.18 : DIM.fill,
          stroke: REGION_COLORS[z.id],
          strokeOpacity: lit(z.id) ? 1 : DIM.line,
          strokeWidth: focus ? (lit(z.id) ? 3 : 1.5) : 2.5,
          clip: "frame",
        }),
      ),
      Plot.dot(cities, { x: "lon", y: "lat", r: focus ? 5 : 3.5, fill: "var(--c-text)", stroke: "var(--c-ground)", strokeWidth: 1.5 }),
      ...(["start", "end"] as const).map((anchor) =>
        Plot.text(
          labels.filter((p) => eastSide(p) === (anchor === "start")),
          {
            x: "lon",
            y: "lat",
            text: "name",
            textAnchor: anchor,
            dx: focus ? (anchor === "start" ? 10 : -4) : 0,
            // A west-side name sits well above its dot, clear of a name on
            // the same line to its west: Loveland's, beside Greeley, which
            // overlapped at -8 (e2e/l8.spec.ts, the label-overlap check).
            dy: anchor === "end" ? -16 : 0,
            lineAnchor: anchor === "end" ? "bottom" : "middle",
            fontWeight: 700,
            // Plot reads a fontSize string as a field name unless it looks like "18px",
            // so the token goes in as a constant channel (as lib/regions/map.ts does).
            fontSize: () => "var(--t-step-0)",
            fill: "var(--c-text)",
            stroke: "var(--c-ground)",
            strokeWidth: 4,
            paintOrder: "stroke",
          },
        ),
      ),
    ],
  });
}
