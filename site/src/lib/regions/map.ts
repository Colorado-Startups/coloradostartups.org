// The Front Range map on /regions/, rendered to an SVG string at build time
// through lib/plot.ts, like the Leaderboard charts (no `tip` marks).
// Each city carries an SVG <title>, so a pointer still gets a native tooltip
// with no client JavaScript. Owner: L8.

import type { Region, RegionId } from "@cs/shared";
import * as Plot from "@observablehq/plot";

import { COLORADO_PLACES, type Place } from "../leaderboard/places";
import { renderPlot, type ChartText } from "../plot";
import { loadGeo } from "../seats/load";

// One color per region, from the brand tokens. The trio passed the dataviz
// palette validator on --c-ground (#FFFBF3) with all pairs compared, since any
// two regions can sit side by side on a map: lightness band, chroma floor,
// color-vision separation and the normal-vision floor all pass. Deep gold sits
// at 2.52:1 against the ground, under the 3:1 mark target, so every city is
// labelled on the map and listed in the table under it (validator run
// 2026-10-18). Rerun it if L12 changes these tokens.
export const REGION_COLORS: Readonly<Record<RegionId, string>> = {
  "photon-mountain": "var(--c-accent-deep)",
  "space-peak": "var(--c-community)",
  "fusion-canyon": "var(--c-link)",
};

const TEXT = "var(--c-text)";
const DIM = "var(--c-text-dim)";
const GROUND = "var(--c-ground)";
// Map text is the type scale's smallest step, 15 px (lib/plot.ts); region
// names take the next, 18 px (brand_tokens.yaml). Plot reads a mark's fontSize
// string as a field name unless it looks like "18px", so a token goes in as a
// constant channel, and each label gets font-size="var(...)".
const REGION_NAME_SIZE = () => "var(--t-step-0)";

// The view: the Front Range from north of Fort Collins to south of Pikes Peak,
// with a strip of mountains to the west and plains to the east. The range runs
// about twice as far north to south as east to west, so the map is tall. The
// box only sets what the projection fits; it is not drawn.
const WEST = -105.8;
const EAST = -104.35;
const SOUTH = 38.66;
const NORTH = 40.72;
const VIEW = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [WEST, SOUTH],
        [WEST, NORTH],
        [EAST, NORTH],
        [EAST, SOUTH],
        [WEST, SOUTH],
      ],
    ],
  },
};

// Summits for orientation: Longs Peak and Pikes Peak, the ones the seat maps
// mark, read from data/positions/geo.yaml (USGS GNIS points, #180).
const PEAKS = loadGeo().peaks;
const PEAK_WEST: ReadonlySet<string> = new Set(["Pikes Peak"]);

// The mountain front, where the foothills meet the plains (#247). Each point
// is a landmark on the front, at the coordinates its English Wikipedia article
// gives (read 2026-11-02), rounded to four decimals: Horsetooth Mountain west
// of Fort Collins, Lyons where the St. Vrain leaves the foothills, the
// Flatirons above Boulder (the article gives a tenth of a degree), Lookout
// Mountain above Golden, Red Rocks Amphitheatre, Roxborough State Park,
// Garden of the Gods and Cheyenne Mountain. From the first and the last, the
// line runs straight to the map's north and south edges. Boulder and Golden
// sit at the foot of the front, so at the articles' points the line ran under
// their dots, 7.1 and 6.9 units from their centers. The Flatirons point moves
// 0.01 degrees west and Lookout Mountain's 0.0114 degrees west, so
// each center is at least 8.5 units from the line: the dot's 6, half its
// 2-unit ring and half the line's 3-unit stroke.
const FRONT: readonly Place[] = [
  { lat: NORTH, lon: -105.1968 },
  { lat: 40.5396, lon: -105.1968 }, // Horsetooth Mountain
  { lat: 40.2183, lon: -105.2506 }, // Lyons
  { lat: 40.0, lon: -105.31 }, // Flatirons, moved west
  { lat: 39.7325, lon: -105.25 }, // Lookout Mountain, moved west
  { lat: 39.6653, lon: -105.2058 }, // Red Rocks Amphitheatre
  { lat: 39.4297, lon: -105.0692 }, // Roxborough State Park
  { lat: 38.8678, lon: -104.8911 }, // Garden of the Gods
  { lat: 38.737, lon: -104.8809 }, // Cheyenne Mountain
  { lat: SOUTH, lon: -104.8809 },
];
// At a phone's label size, "Colorado Springs" is wider than the plains
// between the front and the map's east edge near its dot, so its label cannot
// sit on the plains without crossing the front. The line breaks under it, as a
// map's lines break under its names. The gap clears the label's phone-size
// box (test/unit/l8/map.test.ts) by 8 units above and below.
const FRONT_GAP = { north: 38.97, south: 38.855 };

/** The front's longitude at a latitude, read off the line between its points. */
function frontLon(lat: number): number {
  for (let i = 1; i < FRONT.length; i++) {
    const a = FRONT[i - 1]!;
    const b = FRONT[i]!;
    if (lat <= a.lat && lat >= b.lat) return a.lon + ((a.lat - lat) / (a.lat - b.lat)) * (b.lon - a.lon);
  }
  throw new Error(`the front does not reach latitude ${lat}`);
}

// Plot.line leaves a gap at a point with no position.
const FRONT_LINE: readonly Place[] = [
  ...FRONT.filter((p) => p.lat > FRONT_GAP.north),
  { lat: FRONT_GAP.north, lon: frontLon(FRONT_GAP.north) },
  { lat: Number.NaN, lon: Number.NaN },
  { lat: FRONT_GAP.south, lon: frontLon(FRONT_GAP.south) },
  ...FRONT.filter((p) => p.lat < FRONT_GAP.south),
];

// Label placement by hand, for the cities whose neighbors sit too close for a
// label to the east, and for Colorado Springs, whose long name ran past the
// map's east edge at a phone's label size (#328). Every other city is
// labelled to its east. No label crosses the front (#247): Loveland's moved
// from west to east of its dot. Golden's stays west, between the front and
// the mountains, because Arvada's and Denver's dots fill its east.
type Side = "east" | "west" | "north" | "south";
const LABEL_SIDE: Readonly<Record<string, Side>> = {
  Golden: "west",
  Arvada: "north",
  Windsor: "north",
  "Colorado Springs": "north",
};
// Extra units [east, down] for a label that would still touch a marker or the
// front on its side. Above its dot, "Colorado Springs" ran over the Pikes Peak
// triangle at a phone's label size (review of #344). West of its dot, Golden's
// label sat 2 units from the front, and it moves 4 more units west with the
// front's Lookout Mountain point. East of its dot, Loveland's ran into
// Greeley's dot (#247).
const LABEL_NUDGE: Readonly<Record<string, readonly [number, number]>> = {
  "Colorado Springs": [0, -16],
  Golden: [-8, 0],
  Loveland: [0, 14],
};

// Where each region's name sits beside its cities: below all three. The west
// edge is too close for Photon Mountain's, Colorado Springs' own label takes
// the east of Space Peak, and at a phone's larger label size Fusion Canyon's
// ran off the west edge (#248).
const REGION_LABEL_SIDE: Readonly<Record<RegionId, Side>> = {
  "photon-mountain": "south",
  "space-peak": "south",
  "fusion-canyon": "south",
};
// Degrees east and north to move a region's name from below the middle of its
// cities. Centered there, each name ran west across the front at a phone's
// label size; Fusion Canyon's also moves down, clear of Loveland's label
// (#247).
const REGION_NAME_SHIFT: Readonly<Record<RegionId, Place>> = {
  "photon-mountain": { lon: 0.39, lat: 0 },
  "space-peak": { lon: 0.21, lat: 0 },
  "fusion-canyon": { lon: 0.1, lat: -0.04 },
};

export interface MapCity extends Place {
  city: string;
  region: RegionId;
  regionName: string;
}

/** Every core city of every region, with its map position. Throws on a city places.ts lacks. */
export function mapCities(regions: readonly Region[]): MapCity[] {
  return regions.flatMap((r) =>
    r.cities.map((city) => {
      const place = COLORADO_PLACES[city];
      if (!place) throw new Error(`${r.id} lists "${city}", which lib/leaderboard/places.ts cannot place on the map`);
      return { city, region: r.id, regionName: r.name, ...place };
    }),
  );
}

const OFFSET = 11;
function anchor(side: Side) {
  switch (side) {
    case "west":
      return { dx: -OFFSET, dy: 0, textAnchor: "end" as const };
    case "north":
      return { dx: 0, dy: -OFFSET - 3, textAnchor: "middle" as const };
    case "south":
      return { dx: 0, dy: OFFSET + 5, textAnchor: "middle" as const };
    default:
      return { dx: OFFSET, dy: 0, textAnchor: "start" as const };
  }
}

/** Where a region's name goes: beside the middle of its cities, on its label side. */
export function regionLabelAt(cities: readonly MapCity[], side: Side): Place {
  const lats = cities.map((c) => c.lat);
  const lons = cities.map((c) => c.lon);
  const lat = lats.reduce((n, v) => n + v, 0) / lats.length;
  const lon = lons.reduce((n, v) => n + v, 0) / lons.length;
  switch (side) {
    case "west":
      return { lat, lon: Math.min(...lons) - 0.3 };
    case "east":
      return { lat, lon: Math.max(...lons) + 0.3 };
    case "north":
      return { lat: Math.max(...lats) + 0.11, lon };
    default:
      return { lat: Math.min(...lats) - 0.11, lon };
  }
}

/** The three regions on the Front Range: a soft wash per region, a dot and a label per core city. */
export function frontRangeMap(regions: readonly Region[], text: ChartText): string {
  const cities = mapCities(regions);
  return renderPlot({
    ariaLabel: text.label,
    ariaDescription: text.description,
    // 420 units: a 360 px phone shows the map 312 px wide, so the 21-unit
    // phone labels (regions/index.astro) draw at 15.6 px (#329).
    width: 420,
    projection: { type: "mercator", domain: VIEW, inset: 6 },
    marks: [
      ...groundMarks(),
      ...regionWashes(regions, cities),
      ...cityDots(regions, cities),
      ...cityLabels(cities),
      ...regionNames(regions, cities),
    ],
  });
}

/** An italic note in the dim color, such as "Mountains". */
const note = (lon: number, lat: number, label: string, textAnchor: "start" | "end") =>
  Plot.text([{ lon, lat }], { x: "lon", y: "lat", text: () => label, textAnchor, fill: DIM, fontStyle: "italic" });

/** The mountain front, the Mountains and Plains notes, and the peaks, under everything else. */
function groundMarks(): Plot.Markish[] {
  return [
    // Mountains and Plains sit either side of the front. A non-text mark needs
    // 3:1 (WCAG 1.4.11): --c-border is 4.11:1 on the band's surface and 4.46:1
    // on ground (brand_tokens.yaml); --c-stone-edge, a decoration token, was
    // 1.92:1 and 2.08:1.
    Plot.line(FRONT_LINE, { x: "lon", y: "lat", stroke: "var(--c-border)", strokeWidth: 3, strokeLinecap: "round" }),
    note(WEST + 0.03, 39.45, "Mountains", "start"),
    note(EAST - 0.03, 39.45, "Plains", "end"),
    Plot.dot(PEAKS, { x: "lon", y: "lat", symbol: "triangle", r: 5, fill: DIM, title: "name" }),
    // A peak's name hangs from its top, 12 units under the triangle, starting
    // 34 units west of its point. A phone's larger size, or a wider font, grows
    // down and east into the map: centered, Longs Peak's name ran past the
    // west edge in CI (#344), and flush with the triangle's left edge it ran
    // across the front (#247). Pikes Peak's goes west instead: below it sits
    // Space Peak's name (#344 review).
    Plot.text(
      PEAKS.filter((p) => !PEAK_WEST.has(p.name)),
      { x: "lon", y: "lat", text: "name", textAnchor: "start", lineAnchor: "top", dx: -34, dy: 12, fill: DIM },
    ),
    Plot.text(PEAKS.filter((p) => PEAK_WEST.has(p.name)), { x: "lon", y: "lat", text: "name", ...anchor("west"), fill: DIM }),
  ];
}

/** A wash at about 12% opacity under each region's cities: its area, not a value. */
function regionWashes(regions: readonly Region[], cities: readonly MapCity[]): Plot.Markish[] {
  return regions.map((r) =>
    Plot.dot(
      cities.filter((c) => c.region === r.id),
      { x: "lon", y: "lat", r: 34, fill: REGION_COLORS[r.id], fillOpacity: 0.12 },
    ),
  );
}

/** City dots with a 2px ground ring, and a native tooltip. */
function cityDots(regions: readonly Region[], cities: readonly MapCity[]): Plot.Markish[] {
  return regions.map((r) =>
    Plot.dot(
      cities.filter((c) => c.region === r.id),
      {
        x: "lon",
        y: "lat",
        r: 6,
        fill: REGION_COLORS[r.id],
        stroke: GROUND,
        strokeWidth: 2,
        title: (d: MapCity) => `${d.city}, ${d.regionName}`,
      },
    ),
  );
}

/** City labels in the text color with a ground halo, never in the region color, one mark per side and nudge. */
function cityLabels(cities: readonly MapCity[]): Plot.Markish[] {
  const groups = new Map<string, { side: Side; nudge: readonly [number, number]; cities: MapCity[] }>();
  for (const c of cities) {
    const side = LABEL_SIDE[c.city] ?? "east";
    const nudge: readonly [number, number] = LABEL_NUDGE[c.city] ?? [0, 0];
    const key = `${side} ${nudge.join(" ")}`;
    const group = groups.get(key) ?? { side, nudge, cities: [] };
    group.cities.push(c);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ side, nudge, cities: group }) => {
    const at = anchor(side);
    return Plot.text(group, {
      x: "lon",
      y: "lat",
      text: "city",
      ...at,
      dx: at.dx + nudge[0],
      dy: at.dy + nudge[1],
      fill: TEXT,
      stroke: GROUND,
      strokeWidth: 4,
    });
  });
}

/** Region names, larger and bold, set apart from the city labels. */
function regionNames(regions: readonly Region[], cities: readonly MapCity[]): Plot.Markish[] {
  return regions.map((r) => {
    const side = REGION_LABEL_SIDE[r.id];
    const at = regionLabelAt(
      cities.filter((c) => c.region === r.id),
      side,
    );
    const shift = REGION_NAME_SHIFT[r.id];
    const textAnchor = side === "west" ? "end" : side === "east" ? "start" : "middle";
    return Plot.text([{ lat: at.lat + shift.lat, lon: at.lon + shift.lon, name: r.name }], {
      x: "lon",
      y: "lat",
      text: "name",
      textAnchor,
      fill: TEXT,
      stroke: GROUND,
      strokeWidth: 5,
      fontSize: REGION_NAME_SIZE,
      fontWeight: 700,
    });
  });
}
