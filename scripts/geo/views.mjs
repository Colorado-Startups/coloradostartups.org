#!/usr/bin/env node
// The map's views: the statewide map, one zoomed map per region, and one
// 16:9 thumbnail per region. For each it builds:
//
//   data/geo/views.json                     the view's frame: its four edges, in degrees, and its size in px
//   data/geo/highways.geojson               the highways inside the frame, from US Census road lines
//   site/src/assets/maps/relief-<view>.jpg  the shaded relief that fills the frame, from USGS 3DEP
//
// Every view is Web Mercator, the projection the live map uses, so the relief
// image, the drawing and the live map line up.
//
//   node scripts/geo/views.mjs          fetch the highways and the relief, write all three
//   node scripts/geo/views.mjs --check  offline: fail if views.json no longer matches the zones
//
// Sources: US Census Bureau TIGERweb (roads) and the USGS 3D Elevation Program
// (relief). Both are public domain; data/geo/README.md credits them.
// Exit codes (04_tools/README.md): 0 clean, 1 drift, 2 usage error, 3 could not fetch or read.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format, OUT, simplify } from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS = join(ROOT, "site/src/assets/maps");
const TIGER_ROADS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer";
const RELIEF = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const AGENT = { "User-Agent": "coloradostartups.org geo build" };

/**
 * Frame sizes in px: the statewide and zoomed maps, and the 16:9 thumbnail. A
 * thumbnail draws about 373 px wide in a three-card row at 1280 px, so its
 * frame is a little under that: its 15 px names then draw at 15 px or more,
 * the rule e2e/l8.spec.ts checks.
 */
export const SIZE = { full: [640, 470], thumb: [368, 207] };
/** Air around what a view shows, as a share of the frame on each side. */
const PAD = { state: 0.03, zone: 0.16, thumb: 0.2 };

const round5 = (v) => Math.round(v * 1e5) / 1e5;
// Web Mercator's north-south axis, in the same degrees as longitude.
const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercLat = (y) => (360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / 180)) - 90;

/** The frame that holds [[west, south], [east, north]] with `pad` of air on every side, at the size's ratio. */
export function frame([[west, south], [east, north]], [width, height], pad) {
  const [y0, y1] = [mercY(south), mercY(north)];
  const w = Math.max(east - west, (y1 - y0) * (width / height)) / (1 - 2 * pad);
  const h = (w * height) / width;
  const [cx, cy] = [(west + east) / 2, (y0 + y1) / 2];
  return { west: round5(cx - w / 2), south: round5(mercLat(cy - h / 2)), east: round5(cx + w / 2), north: round5(mercLat(cy + h / 2)), width, height };
}

function bounds(points) {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** views.json as an object: `state`, then `zone-<id>` and `thumb-<id>` for each region. */
export function buildViews(colorado, regions) {
  const views = { state: frame(bounds(colorado.features[0].geometry.coordinates[0]), SIZE.full, PAD.state) };
  for (const z of regions.features) {
    // A zone's view holds its loop and its cities: a corner city can sit just outside the line.
    const box = bounds([...z.geometry.coordinates[0], ...z.properties.cityPoints.map((c) => [c.lon, c.lat])]);
    views[`zone-${z.id}`] = frame(box, SIZE.full, PAD.zone);
    views[`thumb-${z.id}`] = frame(box, SIZE.thumb, PAD.thumb);
  }
  return views;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const json = (o) => `${JSON.stringify(o, null, 1)}\n`;

// ---- Fetch ----

async function getJson(url) {
  const res = await fetch(url, { headers: AGENT });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  // ArcGIS reports a bad query as HTTP 200 with an error body.
  if (data?.error) throw new Error(`${url}: ${data.error.message ?? JSON.stringify(data.error)}`);
  return data;
}

const KIND = { I: "interstate", U: "us", S: "state" };
/** "I- 25" to "I-25", "US Hwy 287" to "US-287", "State Hwy 14" to "CO-14". */
const roadLabel = (name) => name.replace(/^I- /, "I-").replace(/^US Hwy /, "US-").replace(/^State Hwy /, "CO-");

/**
 * The numbered highways inside a [west, south, east, north] box, one feature
 * a road: its lines cut to the box and every bend under tolKm dropped.
 */
async function fetchHighways(view, box, layers, types, tolKm) {
  const byName = new Map();
  for (const layer of layers) {
    const q = new URLSearchParams({
      where: `RTTYP IN (${types.map((t) => `'${t}'`).join(",")})`,
      geometry: box.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "NAME,RTTYP",
      geometryPrecision: "5",
      f: "geojson",
    });
    const d = await getJson(`${TIGER_ROADS}/${layer}/query?${q}`);
    if (d.exceededTransferLimit || d.properties?.exceededTransferLimit) throw new Error(`road layer ${layer}: more lines than one page for ${view}`);
    if (!Array.isArray(d.features)) throw new Error(`road layer ${layer}: no feature list for ${view}`);
    for (const { properties: p, geometry: g } of d.features) {
      // A business route, a spur or an express lane is not the road itself.
      if (!g || !/^(I- |US Hwy |State Hwy )\d+$/.test(p.NAME ?? "")) continue;
      const road = byName.get(p.NAME) ?? { kind: KIND[p.RTTYP], lines: [] };
      byName.set(p.NAME, road);
      for (const line of g.type === "LineString" ? [g.coordinates] : g.coordinates) {
        // Keep the runs of points inside the box.
        let run = [];
        for (const pt of [...line, null]) {
          if (pt && pt[0] >= box[0] && pt[0] <= box[2] && pt[1] >= box[1] && pt[1] <= box[3]) run.push(pt);
          else {
            if (run.length > 1) road.lines.push(simplify(run, tolKm));
            run = [];
          }
        }
      }
    }
  }
  const roads = [...byName.entries()]
    .filter(([, road]) => road.lines.length)
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([name, road]) => ({
      type: "Feature",
      properties: { view, name: roadLabel(name), kind: road.kind },
      geometry: { type: "MultiLineString", coordinates: road.lines },
    }));
  // Every view here has Interstate 25 in it: a view with no highway is a failed fetch, not a quiet place.
  if (!roads.length) throw new Error(`no highways found for ${view} inside [${box}]`);
  return roads;
}

/** A grey shaded relief that fills a frame exactly, as JPEG bytes, at twice the frame's px. */
async function fetchRelief(v) {
  const R = 20037508.342789244; // half the Web Mercator world, in metres
  const box = [v.west, mercY(v.south), v.east, mercY(v.north)].map((deg) => (deg * R) / 180);
  const q = new URLSearchParams({
    bbox: box.join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: `${v.width * 2},${v.height * 2}`,
    format: "jpg",
    compressionQuality: "82",
    // "Hillshade Gray": mid-grey flat ground with strong slopes, which a CSS overlay blend turns into light and shade.
    renderingRule: JSON.stringify({ rasterFunction: "Hillshade Gray" }),
    f: "image",
  });
  // The image service answers 502 after a few quick requests; five tries, longer apart each time.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${RELIEF}?${q}`, { headers: AGENT });
    if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) return Buffer.from(await res.arrayBuffer());
    if (attempt === 5) throw new Error(`USGS relief: HTTP ${res.status} ${res.headers.get("content-type")}`);
    await new Promise((done) => setTimeout(done, attempt * 8000));
  }
}

// ---- CLI ----

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg && arg !== "--check") {
    console.error("usage: node scripts/geo/views.mjs [--check]");
    process.exit(2);
  }
  try {
    const regions = readJson(join(OUT, "regions.geojson"));
    const views = buildViews(readJson(join(OUT, "colorado.geojson")), regions);
    if (arg === "--check") {
      if (json(views) !== readFileSync(join(OUT, "views.json"), "utf8")) {
        console.error("geo: data/geo/views.json is stale; run node scripts/geo/views.mjs");
        process.exit(1);
      }
      console.log("geo: views.json matches the zones and the outline");
      process.exit(0);
    }
    mkdirSync(ASSETS, { recursive: true });
    const box = (v) => [v.west, v.south, v.east, v.north];
    // Statewide: the generalized interstates and US highways. A px is about a km, so bends under 1.5 km go.
    const features = await fetchHighways("state", box(views.state), [0, 3], ["I", "U"], 1.5);
    for (const z of regions.features) {
      // One set of roads serves the zoomed map and the thumbnail: the box that holds both frames.
      const [a, b] = [views[`zone-${z.id}`], views[`thumb-${z.id}`]];
      const both = [Math.min(a.west, b.west), Math.min(a.south, b.south), Math.max(a.east, b.east), Math.max(a.north, b.north)];
      // A px is 100 to 150 m in these views.
      features.push(...(await fetchHighways(z.id, both, [2, 6], ["I", "U", "S"], 0.1)));
    }
    // Fetch every relief before writing anything: a failed fetch then leaves the frames, roads and images that were there, still matching.
    const reliefs = [];
    for (const [id, v] of Object.entries(views)) reliefs.push([id, await fetchRelief(v)]);
    writeFileSync(
      join(OUT, "highways.geojson"),
      format({
        type: "FeatureCollection",
        source:
          "US Census Bureau TIGERweb, Transportation layers 0 and 3 (statewide) and 2 and 6 (each region): the numbered highways inside each map view of data/geo/views.json, cut to the view by scripts/geo/views.mjs",
        license: "CC0-1.0 (Census data is not copyrighted)",
        features,
      }),
    );
    writeFileSync(join(OUT, "views.json"), json(views));
    for (const [id, image] of reliefs) writeFileSync(join(ASSETS, `relief-${id}.jpg`), image);
    console.log(`geo: ${Object.keys(views).length} views, ${features.length} highways and ${Object.keys(views).length} relief images written`);
  } catch (err) {
    console.error(`geo: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(3);
  }
}
