// The live layer of ColoradoMap: MapLibre GL JS over OpenFreeMap tiles, with
// shaded relief, the three zones and the cities drawn on top. Ported from
// Fusion Canyon's corridor map (Colorado-Startups/fusion-canyon PR #11).
//
// - Loads only when a visitor presses the map's "Explore the live map" button:
//   the drawing is the map until then, and the page pays nothing (MapLibre is
//   about 250 KB compressed). The button shows only where WebGL2 exists.
// - MapLibre 6 is ES modules only. Its worker is one self-contained file, and
//   setWorkerUrl points at our same-origin copy, which MapLibre 6 starts as a
//   module worker directly: script-src and worker-src stay 'self', no blob:.
// - Light or dark basemap from the page's theme; switching themes swaps the
//   style, and `style.load` re-adds the relief and the zones, which setStyle wipes.
// - cooperativeGestures: the page scrolls past the map; a pinch or a held
//   key zooms it. Zoom buttons cover single-pointer use (WCAG 2.5.1).
// - Zone colors are the region tokens, read off the page, so they follow the theme. Each
//   zone line is three strokes, as in the drawing: a glow, a dark casing, the line.
// - A figure with data-zone (ColoradoMap's `zone`) fits that zone's bounds and
//   dims the other two. The basemap names its towns, and the zone fills the
//   frame, so it draws no zone names.
import type { RegionId } from "@cs/shared";
import type { ExpressionSpecification, GeoJSONSourceSpecification, Map as MlMap, RasterDEMSourceSpecification } from "maplibre-gl";

import { COLORADO, COLORADO_BOUNDS, DIM, ZONES, zoneBounds, zoneLabelPoint } from "../../lib/regions/colorado-geo";
import { REGION_TOKENS } from "../../lib/regions/map";

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

// Shaded relief: Mapterhorn's open terrain tiles, as Fusion Canyon's map uses them.
const TERRAIN: RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
  encoding: "terrarium",
  tileSize: 512,
  maxzoom: 14,
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
};

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

/** A zone paint value: `on` for the focused zone, or every zone on the statewide map; `off` for a dimmed one. */
function byFocus(zone: RegionId | undefined, on: number, off: number): number | ExpressionSpecification {
  return zone ? ["case", ["==", ["get", "id"], zone], on, off] : on;
}

function addOverlay(map: MlMap, zone: RegionId | undefined) {
  if (map.getSource("cs-zones")) return;
  const below = firstSymbolId(map);
  const zones = {
    type: "FeatureCollection" as const,
    // The same region tokens the drawing paints (REGION_TOKENS), read in the current theme.
    features: ZONES.features.map((z) => ({ ...z, properties: { id: z.id, color: token(REGION_TOKENS[z.id]) } })),
  };
  const cities = {
    type: "FeatureCollection" as const,
    features: ZONES.features
      .filter((z) => !zone || z.id === zone)
      .flatMap((z) =>
        z.properties.cityPoints.map((c) => ({
          type: "Feature" as const,
          properties: { name: c.name },
          geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
        })),
      ),
  };
  const dark = scheme() === "dark";
  map.addSource("cs-terrain", TERRAIN);
  map.addSource("cs-state", { type: "geojson", data: COLORADO as unknown as GeoJSONSourceSpecification["data"] });
  map.addSource("cs-zones", { type: "geojson", data: zones as unknown as GeoJSONSourceSpecification["data"] });
  map.addSource("cs-cities", { type: "geojson", data: cities });
  map.addLayer(
    {
      id: "cs-relief",
      type: "hillshade",
      source: "cs-terrain",
      paint: {
        "hillshade-exaggeration": dark ? 0.7 : 0.45,
        "hillshade-shadow-color": dark ? "#000000" : token("--c-text-dim"),
        "hillshade-highlight-color": dark ? token("--c-border") : "#ffffff",
        "hillshade-accent-color": dark ? "#000000" : token("--c-text-dim"),
      },
    },
    below,
  );
  map.addLayer({ id: "cs-state-line", type: "line", source: "cs-state", paint: { "line-color": token("--c-border"), "line-width": 1.5 } }, below);
  map.addLayer(
    { id: "cs-zones-fill", type: "fill", source: "cs-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": byFocus(zone, 0.18, DIM.fill) } },
    below,
  );
  const round = { "line-join": "round", "line-cap": "round" } as const;
  map.addLayer(
    {
      id: "cs-zones-glow",
      type: "line",
      source: "cs-zones",
      layout: round,
      paint: { "line-color": ["get", "color"], "line-width": zone ? 14 : 10, "line-blur": 6, "line-opacity": byFocus(zone, 0.45, 0) },
    },
    below,
  );
  map.addLayer(
    {
      id: "cs-zones-casing",
      type: "line",
      source: "cs-zones",
      layout: round,
      paint: { "line-color": token("--c-night"), "line-width": zone ? 5.5 : 4.5, "line-opacity": byFocus(zone, 0.6, 0) },
    },
    below,
  );
  map.addLayer(
    {
      id: "cs-zones-line",
      type: "line",
      source: "cs-zones",
      layout: round,
      paint: { "line-color": ["get", "color"], "line-width": byFocus(zone, zone ? 3 : 2.5, 1.5), "line-opacity": byFocus(zone, 1, DIM.line) },
    },
    below,
  );
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
  figure.dataset.map = "loading";
  const [maplibregl, { default: workerUrl }] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  maplibregl.setWorkerUrl(workerUrl);
  const zone = figure.dataset.zone as RegionId | undefined;
  const map = new maplibregl.Map({
    container: host,
    style: STYLES[scheme()],
    bounds: zone ? zoneBounds(zone) : COLORADO_BOUNDS,
    fitBoundsOptions: { padding: zone ? 32 : 16 },
    cooperativeGestures: true,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.getCanvas().setAttribute("aria-label", host.dataset.label ?? "Map of Colorado");
  map.on("style.load", () => addOverlay(map, zone));
  // The zone names are HTML, in the site's own type, and survive a style swap.
  // On a phone-width map they sit west of the zones, or the plains clip them.
  const west = host.clientWidth < 480;
  for (const z of zone ? [] : ZONES.features) {
    const el = document.createElement("span");
    el.className = "colorado-map__label";
    el.textContent = z.properties.name;
    new maplibregl.Marker({ element: el, anchor: west ? "right" : "left" }).setLngLat(zoneLabelPoint(z, west ? "west" : "east")).addTo(map);
  }
  // "idle": every tile in view has loaded and drawn. Tests and screenshots wait for it.
  map.once("idle", () => (figure.dataset.map = "idle"));
  // The map is live once its style has loaded. A style or tile host that fails
  // first never gets there: take the map down, so the drawing shows again and
  // the caller can offer another try.
  try {
    await new Promise<void>((resolve, reject) => {
      map.once("load", () => resolve());
      map.once("error", (e) => reject(e.error ?? new Error("the live map did not load")));
    });
  } catch (err) {
    map.remove();
    throw err;
  }
  figure.classList.add("is-live");
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => map.setStyle(STYLES[scheme()], { diff: false }));
}

/**
 * Arms every ColoradoMap's "Explore the live map" button. The drawing is the
 * map until a visitor presses it; then MapLibre loads and takes over. Hovering
 * the button warms up the connection to the tile host.
 */
export function mountColoradoMaps() {
  if (!hasWebGl2()) return;
  for (const figure of document.querySelectorAll<HTMLElement>("[data-colorado-map]")) {
    const open = figure.querySelector<HTMLButtonElement>("[data-map-open]");
    if (!open) continue;
    open.hidden = false;
    open.addEventListener(
      "pointerenter",
      () => {
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = "https://tiles.openfreemap.org";
        document.head.appendChild(link);
      },
      { once: true },
    );
    open.addEventListener("click", () => {
      open.disabled = true;
      open.textContent = "Loading the live map";
      // A failed load leaves the drawing in place, which is the whole map
      // without the basemap, says why in the console, and offers another try.
      mount(figure)
        .then(() => (open.hidden = true))
        .catch((err: unknown) => {
          console.error("The live map did not load:", err);
          figure.dataset.map = "failed";
          open.disabled = false;
          open.textContent = "Try the live map again";
        });
    });
  }
}
