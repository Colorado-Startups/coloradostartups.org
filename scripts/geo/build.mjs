#!/usr/bin/env node
// Builds the Colorado geography the site's maps draw, in data/geo/:
//
//   places.csv         every Colorado Census place (incorporated places and CDPs): geoid, name, lat, lon
//   colorado.geojson   the state outline, simplified
//   regions.geojson    one zone per region: the convex hull of its towns' Census
//                      points, padded 5 km. A proposal, not a legal line.
//
//   node scripts/geo/build.mjs              fetch places and the outline from Census TIGERweb, write all three
//   node scripts/geo/build.mjs --check      offline: rebuild regions.geojson from the committed places.csv
//                                           and data/regions/*.yaml, and fail if it differs
//   node scripts/geo/build.mjs --self-test  known-good and known-bad samples for the geometry helpers
//
// Source: US Census Bureau TIGERweb (tigerweb.geo.census.gov). Census works are
// not copyrighted (17 U.S.C. 105); the Bureau asks to be credited, and data/geo/README.md does.
// The towns come from data/regions/<id>.yaml `cities` and `nearby`.
// Exit codes (04_tools/README.md): 0 clean, 1 drift, overlap or a town with no
// Census place, 2 usage error, 3 could not fetch or read.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = join(ROOT, "data/geo");
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
// Layer 4: incorporated places; layer 5: census designated places (current vintage).
const PLACE_LAYERS = [4, 5];
const PAD_KM = 5;
const CIRCLE_STEPS = 16;
const KM_PER_DEG_LAT = 110.574;

// ---- Geometry (pure, so the self-test and the unit test can call it) ----

/** Lon/lat to km on a plane through lat0: equirectangular, fine at a region's scale. */
export function toKm([lon, lat], lat0) {
  return [lon * 111.32 * Math.cos((lat0 * Math.PI) / 180), lat * KM_PER_DEG_LAT];
}
export function toLonLat([x, y], lat0) {
  return [x / (111.32 * Math.cos((lat0 * Math.PI) / 180)), y / KM_PER_DEG_LAT];
}

/** Andrew's monotone chain. Returns the hull counterclockwise, not closed. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The padded hull of some lon/lat points, as a closed counterclockwise GeoJSON ring. */
export function paddedHull(points, padKm = PAD_KM) {
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const ring = [];
  for (const p of points) {
    const [x, y] = toKm(p, lat0);
    for (let i = 0; i < CIRCLE_STEPS; i++) {
      const a = (2 * Math.PI * i) / CIRCLE_STEPS;
      ring.push([x + padKm * Math.cos(a), y + padKm * Math.sin(a)]);
    }
  }
  const hull = convexHull(ring).map((p) => toLonLat(p, lat0).map((v) => Math.round(v * 1e5) / 1e5));
  return [...hull, hull[0]];
}

/** Ray casting: is a lon/lat point inside a closed ring? */
export function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Do two closed rings overlap (an edge crossing, or one inside the other)? */
export function ringsOverlap(r1, r2) {
  for (let i = 0; i < r1.length - 1; i++) {
    for (let j = 0; j < r2.length - 1; j++) if (segmentsCross(r1[i], r1[i + 1], r2[j], r2[j + 1])) return true;
  }
  return insideRing(r1[0], r2) || insideRing(r2[0], r1);
}

// ---- Data ----

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Local names that differ from the Census place name.
export const ALIASES = { cascade: "Cascade-Chipita Park" };

export function readPlaces(file = join(OUT, "places.csv")) {
  const [header, ...rows] = readFileSync(file, "utf8").trim().split("\n");
  if (header !== "geoid,name,basename,kind,lat,lon") throw new Error(`${file}: unexpected header`);
  return rows.map((r) => {
    const [geoid, name, basename, kind, lat, lon] = r.split(",");
    return { geoid, name, basename, kind, lat: Number(lat), lon: Number(lon) };
  });
}

export function readRegions(dir = join(ROOT, "data/regions")) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => YAML.parse(readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => a.order - b.order);
}

/** The Census place for a town name: an incorporated place first, then a CDP. */
export function findPlace(places, town) {
  const name = norm(ALIASES[norm(town)] ?? town);
  const hits = places.filter((p) => norm(p.basename) === name);
  return hits.find((p) => p.kind === "place") ?? hits[0];
}

/** regions.geojson as an object, or throws listing every town with no Census place or any overlap. */
export function buildRegions(places, regions) {
  const missing = [];
  const features = regions.map((r) => {
    const towns = [...r.cities, ...(r.nearby ?? [])];
    const points = [];
    const cityPoints = [];
    for (const town of towns) {
      const p = findPlace(places, town);
      if (!p) missing.push(`${r.id}: ${town}`);
      else {
        points.push([p.lon, p.lat]);
        if (r.cities.includes(town)) cityPoints.push({ name: town, lon: p.lon, lat: p.lat });
      }
    }
    return {
      type: "Feature",
      id: r.id,
      properties: {
        id: r.id,
        name: r.name,
        cities: r.cities,
        towns: r.nearby ?? [],
        cityPoints,
        method: `convex hull of the Census points of its ${towns.length} towns, padded ${PAD_KM} km`,
        note: "A proposal, not a legal line.",
      },
      geometry: { type: "Polygon", coordinates: [points.length >= 1 ? paddedHull(points) : []] },
    };
  });
  if (missing.length) throw new Error(`no Census place for: ${missing.join("; ")}`);
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (ringsOverlap(features[i].geometry.coordinates[0], features[j].geometry.coordinates[0])) {
        throw new Error(`zones overlap: ${features[i].id} and ${features[j].id}`);
      }
    }
  }
  return {
    type: "FeatureCollection",
    source: "US Census Bureau TIGERweb place points (data/geo/places.csv); towns from data/regions/*.yaml",
    license: "CC0-1.0 (derived from Census data, which is not copyrighted)",
    features,
  };
}

const json = (o) => `${JSON.stringify(o, null, 1)}\n`;

// ---- Fetch (the only network step; --check never fetches) ----

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "coloradostartups.org geo build" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchPlaces() {
  const rows = [];
  for (const layer of PLACE_LAYERS) {
    const q = new URLSearchParams({
      where: "STATE='08'",
      outFields: "GEOID,NAME,BASENAME,INTPTLAT,INTPTLON",
      returnGeometry: "false",
      resultRecordCount: "5000",
      f: "json",
    });
    const d = await getJson(`${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/${layer}/query?${q}`);
    if (d.exceededTransferLimit) throw new Error(`layer ${layer}: more places than one page`);
    for (const { attributes: a } of d.features) {
      rows.push({
        geoid: a.GEOID,
        name: a.NAME.replace(/,/g, " "),
        basename: a.BASENAME.replace(/,/g, " "),
        kind: layer === 4 ? "place" : "cdp",
        lat: Number(a.INTPTLAT),
        lon: Number(a.INTPTLON),
      });
    }
  }
  rows.sort((a, b) => a.geoid.localeCompare(b.geoid));
  return rows;
}

async function fetchOutline() {
  const q = new URLSearchParams({ where: "STATE='08'", outFields: "NAME", outSR: "4326", maxAllowableOffset: "0.01", f: "geojson" });
  const d = await getJson(`${TIGER}/State_County/MapServer/0/query?${q}`);
  const f = d.features?.[0];
  if (!f) throw new Error("no Colorado feature in the State layer");
  const round = (c) => (typeof c[0] === "number" ? c.map((v) => Math.round(v * 1e5) / 1e5) : c.map(round));
  return {
    type: "FeatureCollection",
    source: "US Census Bureau TIGERweb, State_County layer 0, simplified 0.01 degrees",
    license: "CC0-1.0 (Census data is not copyrighted)",
    features: [{ type: "Feature", id: "colorado", properties: { name: "Colorado" }, geometry: { ...f.geometry, coordinates: round(f.geometry.coordinates) } }],
  };
}

// ---- Self-test ----

function selfTest() {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const checks = {
    hull: JSON.stringify(convexHull([[0, 0], [1, 0], [0.5, 0.5], [1, 1], [0, 1]])) === "[[0,0],[1,0],[1,1],[0,1]]",
    inside: insideRing([0.5, 0.5], square) && !insideRing([2, 2], square),
    overlap: ringsOverlap(square, [[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2], [0.5, 0.5]]),
    apart: !ringsOverlap(square, [[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]]),
    padded: (() => {
      const ring = paddedHull([[-105, 40]]);
      return insideRing([-105, 40], ring) && !insideRing([-104.9, 40], ring); // 0.1 degree is about 8.5 km here
    })(),
  };
  const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (bad.length) {
    console.error(`geo self-test: FAIL (${bad.join(", ")})`);
    return 1;
  }
  console.log("geo self-test: PASS");
  return 0;
}

// ---- CLI ----

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg && !["--check", "--self-test"].includes(arg)) {
    console.error("usage: node scripts/geo/build.mjs [--check | --self-test]");
    process.exit(2);
  }
  if (arg === "--self-test") process.exit(selfTest());
  try {
    if (arg === "--check") {
      if (!existsSync(join(OUT, "places.csv"))) throw new Error("data/geo/places.csv is missing; run node scripts/geo/build.mjs");
      const want = json(buildRegions(readPlaces(), readRegions()));
      const have = readFileSync(join(OUT, "regions.geojson"), "utf8");
      if (want !== have) {
        console.error("geo: data/geo/regions.geojson is stale; run node scripts/geo/build.mjs");
        process.exit(1);
      }
      console.log("geo: regions.geojson matches data/regions and places.csv");
      process.exit(0);
    }
    const places = await fetchPlaces();
    const outline = await fetchOutline();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, "places.csv"),
      `geoid,name,basename,kind,lat,lon\n${places.map((p) => [p.geoid, p.name, p.basename, p.kind, p.lat, p.lon].join(",")).join("\n")}\n`,
    );
    writeFileSync(join(OUT, "colorado.geojson"), json(outline));
    const regions = buildRegions(readPlaces(), readRegions());
    writeFileSync(join(OUT, "regions.geojson"), json(regions));
    console.log(`geo: ${places.length} places, the outline and ${regions.features.length} zones written to data/geo/`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`geo: ${msg}`);
    process.exit(/no Census place|overlap/.test(msg) ? 1 : 3);
  }
}
