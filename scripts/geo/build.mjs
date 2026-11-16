#!/usr/bin/env node
// Builds the Colorado geography the site's maps draw, in data/geo/:
//
//   places.csv              every Colorado Census place (incorporated places and CDPs): geoid, name, lat, lon
//   colorado.geojson        the state outline, simplified
//   roads.geojson           each loop's boundary roads, traced along US Census road lines:
//                           one line per road data/geo/boundaries.yaml names
//   regions.geojson         one zone per region: the loop its roads close, with its cities
//                           and its size. A proposal, not a legal line.
//   silicon-valley.geojson  the yardstick loop, traced the same way
//
//   node scripts/geo/build.mjs              fetch everything from Census TIGERweb, write all five
//   node scripts/geo/build.mjs --roads      fetch and trace the roads only, then rebuild the zones and the yardstick
//   node scripts/geo/build.mjs --check      offline: rebuild the zones and the yardstick from the committed files,
//                                           and fail if they differ or boundaries.yaml has moved on
//   node scripts/geo/build.mjs --self-test  known-good and known-bad samples for the geometry helpers
//
// Source: US Census Bureau TIGERweb (tigerweb.geo.census.gov). Census works are
// not copyrighted (17 U.S.C. 105); the Bureau asks to be credited, and data/geo/README.md does.
// The cities come from data/regions/<id>.yaml; their centres from data/positions/geo.yaml (USGS GNIS).
// Exit codes (04_tools/README.md): 0 clean, 1 drift or an unsound loop (a gap, a
// crossing, a city off its line, an overlap, the wrong size, a town with no
// Census place), 2 usage error, 3 could not fetch or read.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = join(ROOT, "data/geo");
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
// Layer 4: incorporated places; layer 5: census designated places (current vintage).
const PLACE_LAYERS = [4, 5];
// Transportation layers 2, 6 and 8: primary, secondary and local roads, at full detail.
const ROAD_LAYERS = [2, 6, 8];
const KM_PER_DEG_LAT = 110.574;
const KM_PER_MI = 1.609344;
const LICENSE = "CC0-1.0 (derived from Census data, which is not copyrighted)";

/** The loop in boundaries.yaml that is the yardstick, never a zone. */
export const YARDSTICK = "silicon-valley";
/** The longest straight bridge over a gap the Census lines leave, such as an interchange. */
export const STITCH_KM = 0.5;
/** How far apart a divided road's two carriageways may run at a junction. */
const CARRIAGEWAY_KM = 0.15;
/** How far from its hint a junction may sit. */
const JUNCTION_KM = 3;
/** A stored road keeps every bend over 5 m; a zone's ring, every bend over 10 m. */
const ROAD_TOLERANCE_KM = 0.005;
const RING_TOLERANCE_KM = 0.01;
/** A corner city may sit this far outside its loop and still be on the line. */
export const ON_THE_LINE_MI = 3;
/** A zone's area, as a multiple of the yardstick's. */
export const SIZE_BAND = [0.75, 2];

/** A loop that does not hold together: exit 1, not a fetch failure. */
class Unsound extends Error {}

// ---- Geometry (pure, so the self-test and the unit test can call it) ----

/** Lon/lat to km on a plane through lat0: equirectangular, fine at a region's scale. */
export function toKm([lon, lat], lat0) {
  return [lon * 111.32 * Math.cos((lat0 * Math.PI) / 180), lat * KM_PER_DEG_LAT];
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const round5 = (v) => Math.round(v * 1e5) / 1e5;
const round1 = (v) => Math.round(v * 10) / 10;

/** Km between two lon/lat points. */
export function distKm(a, b) {
  const lat0 = (a[1] + b[1]) / 2;
  const [ax, ay] = toKm(a, lat0);
  const [bx, by] = toKm(b, lat0);
  return Math.hypot(ax - bx, ay - by);
}

/** Km from a point to a segment, all three on one plane. */
function toSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Twice the signed area of a lon/lat ring: positive when it runs counterclockwise. */
function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a;
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

/** Where a closed ring first crosses itself, or null. */
export function selfCrossing(ring) {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing point
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return ring[i];
    }
  }
  return null;
}

/** Douglas-Peucker: the line with every bend under tolKm dropped. Keeps both ends, and works on a closed ring. */
export function simplify(points, tolKm) {
  if (points.length < 3) return points;
  const P = points.map((p) => toKm(p, points[0][1]));
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const spans = [[0, P.length - 1]];
  while (spans.length) {
    const [a, b] = spans.pop();
    let far = -1;
    let max = tolKm;
    for (let i = a + 1; i < b; i++) {
      const d = toSegment(P[i], P[a], P[b]);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      spans.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring's area in square miles and its widest span in miles. */
export function ringSize(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const P = ring.map((p) => toKm(p, lat0));
  let area = 0;
  for (let i = 0; i < P.length - 1; i++) area += P[i][0] * P[i + 1][1] - P[i + 1][0] * P[i][1];
  let span = 0;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) span = Math.max(span, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]));
  return { area_sq_mi: Math.round(Math.abs(area) / 2 / KM_PER_MI ** 2), span_mi: round1(span / KM_PER_MI) };
}

/** Miles from a lon/lat point to a ring's line. */
export function milesToRing(point, ring) {
  const p = toKm(point, point[1]);
  const P = ring.map((q) => toKm(q, point[1]));
  let min = Infinity;
  for (let i = 0; i < P.length - 1; i++) min = Math.min(min, toSegment(p, P[i], P[i + 1]));
  return min / KM_PER_MI;
}

// ---- Roads: trace a loop along named roads (pure) ----

/** A binary min-heap of [cost, item]. */
function heap() {
  const h = [];
  return {
    get size() {
      return h.length;
    },
    push(cost, item) {
      let i = h.push([cost, item]) - 1;
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (h[up][0] <= h[i][0]) break;
        [h[up], h[i]] = [h[i], h[up]];
        i = up;
      }
    },
    pop() {
      const top = h[0];
      const last = h.pop();
      if (h.length) {
        h[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < h.length && h[l][0] < h[m][0]) m = l;
          if (r < h.length && h[r][0] < h[m][0]) m = r;
          if (m === i) break;
          [h[m], h[i]] = [h[i], h[m]];
          i = m;
        }
      }
      return top[1];
    },
  };
}

/**
 * The shortest way along some road lines between two of their points. Census
 * lines leave gaps (an interchange, a one-way pair), so a dead end is bridged
 * to the nearest point of another piece within STITCH_KM, at three times the
 * cost of road. Returns the points and the length in km of each bridge used,
 * or null when the lines do not connect the two.
 */
export function tracePath(lines, from, to) {
  const nodes = new Map();
  const node = (p) => {
    const key = `${p[0]},${p[1]}`;
    let n = nodes.get(key);
    if (!n) nodes.set(key, (n = { p, xy: toKm(p, from[1]), edges: [], piece: -1, cost: Infinity, prev: null, via: null, done: false }));
    return n;
  };
  const link = (a, b, stitch) => {
    if (a === b) return;
    const km = Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]);
    a.edges.push({ to: b, km, stitch });
    b.edges.push({ to: a, km, stitch });
  };
  for (const line of lines) for (let i = 0; i < line.length - 1; i++) link(node(line[i]), node(line[i + 1]), false);
  const start = nodes.get(`${from[0]},${from[1]}`);
  const goal = nodes.get(`${to[0]},${to[1]}`);
  if (!start || !goal) return null;

  const all = [...nodes.values()];
  let pieces = 0;
  for (const n of all) {
    if (n.piece >= 0) continue;
    n.piece = pieces;
    const stack = [n];
    while (stack.length) {
      for (const e of stack.pop().edges) {
        if (e.to.piece < 0) {
          e.to.piece = pieces;
          stack.push(e.to);
        }
      }
    }
    pieces++;
  }
  if (pieces > 1) {
    for (const end of all.filter((n) => n.edges.length === 1)) {
      let best = null;
      let bestKm = STITCH_KM;
      for (const n of all) {
        if (n.piece === end.piece) continue;
        const km = Math.hypot(n.xy[0] - end.xy[0], n.xy[1] - end.xy[1]);
        if (km <= bestKm) {
          bestKm = km;
          best = n;
        }
      }
      if (best) link(end, best, true);
    }
  }
  // A divided road is two lines that may never touch. The path may start and
  // end on either carriageway, or it runs out to where they join and back.
  for (const end of [start, goal]) {
    for (const n of all) if (n !== end && Math.hypot(n.xy[0] - end.xy[0], n.xy[1] - end.xy[1]) <= CARRIAGEWAY_KM) link(end, n, true);
  }

  const queue = heap();
  start.cost = 0;
  queue.push(0, start);
  while (queue.size) {
    const n = queue.pop();
    if (n.done) continue;
    n.done = true;
    if (n === goal) break;
    for (const e of n.edges) {
      const cost = n.cost + (e.stitch ? 3 * e.km : e.km);
      if (cost < e.to.cost) {
        e.to.cost = cost;
        e.to.prev = n;
        e.to.via = e;
        queue.push(cost, e.to);
      }
    }
  }
  if (goal.cost === Infinity) return null;
  const coordinates = [];
  const stitches = [];
  for (let n = goal; n; n = n.prev) {
    coordinates.push(n.p);
    if (n.via?.stitch) stitches.push(n.via.km);
  }
  return { coordinates: coordinates.reverse(), stitches };
}

/**
 * Where two roads meet near a hint: their closest pair of points, each within
 * JUNCTION_KM of it. Two roads that share a stretch meet all along it; the
 * pair nearest the hint wins. Returns { a, b, km }, a on the first road.
 */
export function junction(linesA, linesB, hint) {
  const near = (lines) => {
    const seen = new Map();
    for (const line of lines) for (const p of line) if (distKm(p, hint) <= JUNCTION_KM) seen.set(`${p[0]},${p[1]}`, { p, xy: toKm(p, hint[1]) });
    return [...seen.values()];
  };
  const A = near(linesA);
  const B = near(linesB);
  let min = Infinity;
  for (const a of A) for (const b of B) min = Math.min(min, Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]));
  if (min === Infinity) return null;
  const h = toKm(hint, hint[1]);
  let best = null;
  let bestToHint = Infinity;
  for (const a of A) {
    const toHint = Math.hypot(a.xy[0] - h[0], a.xy[1] - h[1]);
    if (toHint >= bestToHint) continue;
    // This point's own nearest partner; it counts when the pair is within 15 m of the closest pair anywhere.
    let partner = null;
    let km = min + 0.015;
    for (const b of B) {
      const d = Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]);
      if (d <= km) {
        km = d;
        partner = b;
      }
    }
    if (partner) {
      best = { a: a.p, b: partner.p, km };
      bestToHint = toHint;
    }
  }
  return best;
}

/**
 * Each road of a loop, traced between its two junctions. `legs` are the loop's
 * rows in boundaries.yaml; `lines[i]` are road i's Census lines. Throws when
 * two roads do not meet or a road does not connect its junctions.
 */
export function traceLoop(legs, lines) {
  const n = legs.length;
  const joins = legs.map((leg, i) => {
    const j = junction(lines[i], lines[(i + 1) % n], leg.to);
    if (!j || j.km > STITCH_KM) throw new Unsound(`${leg.road} and ${legs[(i + 1) % n].road} do not meet within ${STITCH_KM * 1000} m near [${leg.to}]`);
    return j;
  });
  return legs.map((leg, i) => {
    const path = tracePath(lines[i], joins[(i - 1 + n) % n].b, joins[i].a);
    if (!path) throw new Unsound(`${leg.road}: its Census lines do not connect its two junctions`);
    return {
      ...leg,
      stitch_m: Math.round(Math.max(0, ...path.stitches) * 1000),
      gap_m: Math.round(joins[i].km * 1000),
      coordinates: simplify(path.coordinates, ROAD_TOLERANCE_KM),
    };
  });
}

/** The closed ring a loop's traced roads make: counterclockwise, as GeoJSON (RFC 7946) wants it. */
export function loopRing(roads) {
  const pts = [];
  for (const r of roads) for (const p of r.coordinates) if (!pts.length || !same(pts.at(-1), p)) pts.push(p);
  // Out along a road and straight back is a spike, not a border.
  for (let i = 1; i < pts.length - 1; ) {
    if (same(pts[i - 1], pts[i + 1])) {
      pts.splice(i, 2);
      i = Math.max(1, i - 1);
    } else i++;
  }
  if (!same(pts[0], pts.at(-1))) pts.push(pts[0]);
  const ring = simplify(pts, RING_TOLERANCE_KM).map((p) => p.map(round5));
  return signedArea(ring) < 0 ? ring.reverse() : ring;
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

/** Loop id to its roads, in order: data/geo/boundaries.yaml. */
export function readBoundaries(file = join(OUT, "boundaries.yaml")) {
  return YAML.parse(readFileSync(file, "utf8"));
}

export function readRoads(file = join(OUT, "roads.geojson")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Town centres by name: the USGS GNIS points in data/positions/geo.yaml. */
export function readCentres(file = join(ROOT, "data/positions/geo.yaml")) {
  const { cities } = YAML.parse(readFileSync(file, "utf8"));
  return new Map(cities.map((c) => [norm(c.name), { lon: c.lon, lat: c.lat }]));
}

/** The Census place for a town name: an incorporated place first, then a CDP. */
export function findPlace(places, town) {
  const name = norm(ALIASES[norm(town)] ?? town);
  const hits = places.filter((p) => norm(p.basename) === name);
  return hits.find((p) => p.kind === "place") ?? hits[0];
}

/** One loop's traced roads, in order, from roads.geojson. */
function loopRoads(roads, id) {
  const legs = roads.features
    .filter((f) => f.properties.loop === id)
    .sort((a, b) => a.properties.order - b.properties.order)
    .map((f) => ({ ...f.properties, coordinates: f.geometry.coordinates }));
  if (!legs.length) throw new Unsound(`data/geo/roads.geojson has no roads for ${id}; run node scripts/geo/build.mjs --roads`);
  return legs;
}

/** Says so when roads.geojson was traced from a boundaries.yaml that has since changed; else null. */
export function roadsDrift(boundaries, roads) {
  const want = Object.entries(boundaries).flatMap(([loop, legs]) => legs.map((l, i) => JSON.stringify([loop, i + 1, l.road, l.names, l.to])));
  const have = roads.features.map(({ properties: p }) => JSON.stringify([p.loop, p.order, p.road, p.names, p.to]));
  return want.length === have.length && want.every((w, i) => w === have[i]) ? null : "data/geo/roads.geojson was traced from an older data/geo/boundaries.yaml";
}

/** silicon-valley.geojson as an object: the yardstick loop and its size. */
export function buildYardstick(roads) {
  const legs = loopRoads(roads, YARDSTICK);
  const ring = loopRing(legs);
  // Every zone's size is measured against this loop, so it must be a sound one.
  const crossing = selfCrossing(ring);
  if (crossing) throw new Unsound(`${YARDSTICK}: its loop crosses itself near [${crossing}]`);
  return {
    type: "FeatureCollection",
    source: "US Census Bureau TIGERweb road lines (data/geo/roads.geojson)",
    license: LICENSE,
    features: [
      {
        type: "Feature",
        id: YARDSTICK,
        properties: {
          id: YARDSTICK,
          name: "Silicon Valley",
          roads: legs.map((l) => l.road),
          ...ringSize(ring),
          note: "The yardstick for a region's size: US-101 and I-280 from Menlo Park to San Jose, closed by CA-84.",
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

/**
 * regions.geojson as an object. Throws, listing every fault, when a loop
 * crosses itself, a city sits off its line, a loop is the wrong size, two
 * zones overlap, or a town has neither a centre nor a Census place.
 */
export function buildRegions(places, regions, roads, centres = new Map()) {
  const yardstick = buildYardstick(roads).features[0].properties;
  const faults = [];
  const features = regions.map((r) => {
    const legs = loopRoads(roads, r.id);
    const ring = loopRing(legs);
    const size = ringSize(ring);
    const ratio = Math.round((size.area_sq_mi / yardstick.area_sq_mi) * 100) / 100;
    // A town's dot: its GNIS centre when data/positions/geo.yaml has one, else its Census place point.
    const point = (town) => {
      const p = centres.get(norm(town)) ?? findPlace(places, town);
      if (!p) faults.push(`${r.id}: no centre and no Census place for ${town}`);
      else if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) faults.push(`${r.id}: ${town} has no usable coordinates`);
      return p ? [{ name: town, lon: p.lon, lat: p.lat }] : [];
    };
    const cityPoints = r.cities.flatMap(point);
    const townPoints = (r.nearby ?? []).flatMap(point);
    const crossing = selfCrossing(ring);
    if (crossing) faults.push(`${r.id}: its loop crosses itself near [${crossing}]`);
    for (const c of cityPoints) {
      const miles = insideRing([c.lon, c.lat], ring) ? 0 : milesToRing([c.lon, c.lat], ring);
      // Written so a NaN fails: a comparison with NaN is always false.
      if (!(miles <= ON_THE_LINE_MI)) faults.push(`${r.id}: ${c.name} sits ${miles.toFixed(1)} mi outside its loop`);
    }
    if (!(ratio >= SIZE_BAND[0] && ratio <= SIZE_BAND[1])) {
      faults.push(`${r.id}: its loop is ${ratio} times ${yardstick.name}'s; the rule is ${SIZE_BAND.join(" to ")}`);
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
        townPoints,
        roads: legs.map((l) => l.road),
        ...size,
        vs_silicon_valley: ratio,
        method: `the loop its ${legs.length} named roads close, traced along US Census road lines`,
        note: "A proposal, not a legal line.",
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (ringsOverlap(features[i].geometry.coordinates[0], features[j].geometry.coordinates[0])) {
        faults.push(`zones overlap: ${features[i].id} and ${features[j].id}`);
      }
    }
  }
  if (faults.length) throw new Unsound(faults.join("; "));
  return {
    type: "FeatureCollection",
    source:
      "US Census Bureau TIGERweb road lines (data/geo/roads.geojson) and place points (data/geo/places.csv); town centres from USGS GNIS (data/positions/geo.yaml); cities from data/regions/*.yaml",
    license: LICENSE,
    features,
  };
}

const json = (o) => `${JSON.stringify(o, null, 1)}\n`;

/** A FeatureCollection as text: its head keys, then one feature per line, so a diff shows which road or zone moved. */
export function format(collection) {
  const { features, ...head } = collection;
  return `${JSON.stringify(head, null, 1).slice(0, -2)},\n "features": [\n${features.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}\n ]\n}\n`;
}

// ---- Fetch (the only network step; --check never fetches) ----

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "coloradostartups.org geo build" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  // ArcGIS reports a bad query as HTTP 200 with an error body.
  if (data.error) throw new Error(`${url}: ${data.error.message ?? JSON.stringify(data.error)}`);
  return data;
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
  const round = (c) => (typeof c[0] === "number" ? c.map(round5) : c.map(round));
  return {
    type: "FeatureCollection",
    source: "US Census Bureau TIGERweb, State_County layer 0, simplified 0.01 degrees",
    license: "CC0-1.0 (Census data is not copyrighted)",
    features: [{ type: "Feature", id: "colorado", properties: { name: "Colorado" }, geometry: { ...f.geometry, coordinates: round(f.geometry.coordinates) } }],
  };
}

/** The Census lines that carry any of some road names, inside a [west, south, east, north] box. */
async function fetchLines(names, box) {
  const lines = [];
  for (const layer of ROAD_LAYERS) {
    const q = new URLSearchParams({
      where: `NAME IN (${names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")})`,
      geometry: box.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "NAME",
      geometryPrecision: "5",
      f: "geojson",
    });
    const d = await getJson(`${TIGER}/Transportation/MapServer/${layer}/query?${q}`);
    if (d.exceededTransferLimit || d.properties?.exceededTransferLimit) throw new Error(`road layer ${layer}: more lines than one page for ${names.join(", ")}`);
    for (const { geometry: g } of d.features ?? []) {
      if (g?.type === "LineString") lines.push(g.coordinates);
      else if (g?.type === "MultiLineString") lines.push(...g.coordinates);
    }
  }
  // A misspelled name finds nothing: a fetch fault (exit 3), not an unsound loop.
  if (!lines.length) throw new Error(`no Census lines named ${names.join(" or ")} inside [${box}]; check the names in data/geo/boundaries.yaml`);
  return lines;
}

/** roads.geojson as an object: every loop in boundaries.yaml, each road traced between its junctions. */
export async function buildRoads(boundaries, linesFor = fetchLines) {
  const PAD = 0.06; // degrees around a road's two junction hints: about 4 miles
  const features = [];
  for (const [loop, legs] of Object.entries(boundaries)) {
    const lines = [];
    for (let i = 0; i < legs.length; i++) {
      const [a, b] = [legs.at(i - 1).to, legs[i].to];
      const box = [Math.min(a[0], b[0]) - PAD, Math.min(a[1], b[1]) - PAD, Math.max(a[0], b[0]) + PAD, Math.max(a[1], b[1]) + PAD];
      lines.push(await linesFor(legs[i].names, box.map(round5)));
    }
    let traced;
    try {
      traced = traceLoop(legs, lines);
    } catch (err) {
      if (err instanceof Unsound) throw new Unsound(`${loop}: ${err.message}`);
      throw err;
    }
    traced.forEach(({ coordinates, ...properties }, i) => {
      features.push({ type: "Feature", properties: { loop, order: i + 1, ...properties }, geometry: { type: "LineString", coordinates } });
    });
  }
  return {
    type: "FeatureCollection",
    source:
      "US Census Bureau TIGERweb, Transportation layers 2, 6 and 8 (primary, secondary and local roads): each road data/geo/boundaries.yaml names, traced between its junctions by scripts/geo/build.mjs",
    license: "CC0-1.0 (Census data is not copyrighted)",
    features,
  };
}

// ---- Self-test ----

function selfTest() {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  // Two streets that meet at [0.01, 0]: one runs east in two pieces 100 m apart, one runs north.
  const east = [[[0, 0], [0.004, 0]], [[0.005, 0], [0.01, 0]]];
  const north = [[[0.01, 0], [0.01, 0.01]]];
  const path = tracePath(east, [0, 0], [0.01, 0]);
  const meet = junction(east, north, [0.0101, 0.0001]);
  const checks = {
    inside: insideRing([0.5, 0.5], square) && !insideRing([2, 2], square),
    overlap: ringsOverlap(square, [[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2], [0.5, 0.5]]),
    apart: !ringsOverlap(square, [[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]]),
    simplify: JSON.stringify(simplify([[0, 0], [0.5, 0.00001], [1, 0], [1, 1]], 0.01)) === "[[0,0],[1,0],[1,1]]",
    crossing: selfCrossing([[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]) !== null && selfCrossing(square) === null,
    // One degree at the equator is about 69 miles a side.
    size: Math.abs(ringSize(square).area_sq_mi - 4752) < 25 && Math.abs(ringSize(square).span_mi - 97.5) < 1,
    offLine: Math.abs(milesToRing([0.5, -0.1], square) - 6.87) < 0.1,
    bridged: path?.coordinates.length === 4 && path.stitches.length === 1 && Math.abs(path.stitches[0] - 0.111) < 0.005,
    unbridged: tracePath([east[0], [[0.02, 0], [0.03, 0]]], [0, 0], [0.03, 0]) === null,
    junction: meet?.km === 0 && meet.a[0] === 0.01 && meet.b[1] === 0,
    ring: (() => {
      // A clockwise loop of four roads comes back counterclockwise and closed.
      const ring = loopRing([[[0, 0], [0, 1]], [[0, 1], [1, 1]], [[1, 1], [1, 0]], [[1, 0], [0, 0]]].map((coordinates) => ({ coordinates })));
      return ring.length === 5 && same(ring[0], ring.at(-1)) && signedArea(ring) > 0;
    })(),
    spike: loopRing([[[0, 0], [0, 1], [0, 2], [0, 1]], [[0, 1], [1, 1]], [[1, 1], [1, 0], [0, 0]]].map((coordinates) => ({ coordinates }))).length === 5,
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

/** Each loop's size, widest bridge and widest junction gap, one line each. */
function sizeTable(roads, regions, yardstick) {
  const rows = [yardstick.features[0], ...regions.features].map(({ properties: p }) => {
    const legs = roads.features.filter((f) => f.properties.loop === p.id).map((f) => f.properties);
    const vs = p.vs_silicon_valley ? `${p.vs_silicon_valley} x` : "yardstick";
    return `  ${p.name.padEnd(16)} ${String(p.roads.length).padStart(2)} roads ${String(p.area_sq_mi).padStart(4)} sq mi ${String(p.span_mi).padStart(5)} mi ${vs.padStart(9)}   bridge ${Math.max(...legs.map((l) => l.stitch_m))} m, gap ${Math.max(...legs.map((l) => l.gap_m))} m`;
  });
  return rows.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg && !["--roads", "--check", "--self-test"].includes(arg)) {
    console.error("usage: node scripts/geo/build.mjs [--roads | --check | --self-test]");
    process.exit(2);
  }
  if (arg === "--self-test") process.exit(selfTest());
  try {
    if (arg === "--check") {
      for (const f of ["places.csv", "roads.geojson"]) if (!existsSync(join(OUT, f))) throw new Error(`data/geo/${f} is missing; run node scripts/geo/build.mjs`);
      const roads = readRoads();
      const stale = [roadsDrift(readBoundaries(), roads)];
      const want = { "regions.geojson": format(buildRegions(readPlaces(), readRegions(), roads, readCentres())), "silicon-valley.geojson": format(buildYardstick(roads)) };
      for (const [f, text] of Object.entries(want)) if (text !== readFileSync(join(OUT, f), "utf8")) stale.push(`data/geo/${f} is stale`);
      const found = stale.filter(Boolean);
      if (found.length) {
        console.error(`geo: ${found.join("; ")}; run node scripts/geo/build.mjs --roads`);
        process.exit(1);
      }
      console.log("geo: the zones and the yardstick match data/regions, boundaries.yaml, roads.geojson and places.csv");
      process.exit(0);
    }
    mkdirSync(OUT, { recursive: true });
    if (!arg) {
      const places = await fetchPlaces();
      writeFileSync(
        join(OUT, "places.csv"),
        `geoid,name,basename,kind,lat,lon\n${places.map((p) => [p.geoid, p.name, p.basename, p.kind, p.lat, p.lon].join(",")).join("\n")}\n`,
      );
      writeFileSync(join(OUT, "colorado.geojson"), json(await fetchOutline()));
    }
    // Build all three before writing any, so a loop that fails its checks leaves the committed files whole.
    const roads = await buildRoads(readBoundaries());
    const yardstick = buildYardstick(roads);
    const regions = buildRegions(readPlaces(), readRegions(), roads, readCentres());
    writeFileSync(join(OUT, "roads.geojson"), format(roads));
    writeFileSync(join(OUT, "silicon-valley.geojson"), format(yardstick));
    writeFileSync(join(OUT, "regions.geojson"), format(regions));
    console.log(`geo: ${roads.features.length} roads, ${regions.features.length} zones and the yardstick written to data/geo/\n${sizeTable(roads, regions, yardstick)}`);
  } catch (err) {
    console.error(`geo: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(err instanceof Unsound ? 1 : 3);
  }
}
