// The live layer of ColoradoMap: MapLibre GL JS over OpenFreeMap tiles, with
// the three zones and the core cities drawn on top. Ported from Fusion
// Canyon's corridor map (Colorado-Startups/fusion-canyon PR #11).
//
// - Loads only when a map scrolls near the screen, so the first screen pays
//   nothing (MapLibre is about 250 KB compressed).
// - MapLibre 6 is ES modules only. Its worker is one self-contained file, and
//   setWorkerUrl points at our same-origin copy, which MapLibre 6 starts as a
//   module worker directly: script-src and worker-src stay 'self', no blob:.
// - Light or dark basemap from the page's theme; switching themes swaps the
//   style, and `style.load` re-adds the zones, which setStyle wipes.
// - cooperativeGestures: the page scrolls past the map; a pinch or a held
//   key zooms it. Zoom buttons cover single-pointer use (WCAG 2.5.1).
// - Zone colors are read off the site's tokens, so they follow the theme.
import type { GeoJSONSourceSpecification, Map as MlMap } from "maplibre-gl";

import { COLORADO, COLORADO_BOUNDS, ZONES, zoneLabelPoint } from "../../lib/regions/colorado-geo";

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

// REGION_COLORS (lib/regions/map.ts) as token names, so the live map and the drawing agree.
const ZONE_TOKEN = {
  "photon-mountain": "--c-accent-deep",
  "space-peak": "--c-community",
  "fusion-canyon": "--c-link",
} as const;

function scheme(): keyof typeof STYLES {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark" || forced === "light") return forced;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The first symbol layer of the base style, so the zones draw under its place names. */
function firstSymbolId(map: MlMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
}

function addOverlay(map: MlMap) {
  if (map.getSource("cs-zones")) return;
  const below = firstSymbolId(map);
  const zones = {
    type: "FeatureCollection" as const,
    features: ZONES.features.map((z) => ({ ...z, properties: { ...z.properties, color: token(ZONE_TOKEN[z.id]) } })),
  };
  const cities = {
    type: "FeatureCollection" as const,
    features: ZONES.features.flatMap((z) =>
      z.properties.cityPoints.map((c) => ({
        type: "Feature" as const,
        properties: { name: c.name },
        geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
      })),
    ),
  };
  map.addSource("cs-state", { type: "geojson", data: COLORADO as unknown as GeoJSONSourceSpecification["data"] });
  map.addSource("cs-zones", { type: "geojson", data: zones as unknown as GeoJSONSourceSpecification["data"] });
  map.addSource("cs-cities", { type: "geojson", data: cities });
  map.addLayer({ id: "cs-state-line", type: "line", source: "cs-state", paint: { "line-color": token("--c-border"), "line-width": 1.5 } }, below);
  map.addLayer({ id: "cs-zones-fill", type: "fill", source: "cs-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 } }, below);
  map.addLayer({ id: "cs-zones-line", type: "line", source: "cs-zones", paint: { "line-color": ["get", "color"], "line-width": 2.5 } }, below);
  map.addLayer({
    id: "cs-cities",
    type: "circle",
    source: "cs-cities",
    paint: { "circle-radius": 4, "circle-color": token("--c-text"), "circle-stroke-color": token("--c-ground"), "circle-stroke-width": 1.5 },
  });
}

/** MapLibre needs WebGL2; without it the drawing stays, and nothing downloads. */
const hasWebGl2 = () => Boolean(document.createElement("canvas").getContext("webgl2"));

async function mount(figure: HTMLElement) {
  const host = figure.querySelector<HTMLElement>("[data-map-canvas]");
  if (!host || !hasWebGl2()) return;
  const [maplibregl, { default: workerUrl }] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  maplibregl.setWorkerUrl(workerUrl);
  const map = new maplibregl.Map({
    container: host,
    style: STYLES[scheme()],
    bounds: COLORADO_BOUNDS,
    fitBoundsOptions: { padding: 16 },
    cooperativeGestures: true,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.getCanvas().setAttribute("aria-label", host.dataset.label ?? "Map of Colorado");
  map.on("style.load", () => addOverlay(map));
  // The zone names are HTML, in the site's own type, and survive a style swap.
  for (const z of ZONES.features) {
    const el = document.createElement("span");
    el.className = "colorado-map__label";
    el.textContent = z.properties.name;
    new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat(zoneLabelPoint(z)).addTo(map);
  }
  map.once("load", () => figure.classList.add("is-live"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => map.setStyle(STYLES[scheme()], { diff: false }));
}

/** Mounts every ColoradoMap on the page when it nears the screen. */
export function mountColoradoMaps() {
  const figures = document.querySelectorAll<HTMLElement>("[data-colorado-map]");
  if (!figures.length || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        // A failed load leaves the drawing in place, which is the whole map without the basemap.
        mount(e.target as HTMLElement).catch(() => undefined);
      }
    },
    { rootMargin: "200px" },
  );
  for (const f of figures) io.observe(f);
}
