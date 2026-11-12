// The Front Range map's marks (front-range.ts): core links, Ute Pass,
// landmarks, peaks, cities, the inset and the north arrow, each drawn from
// one drawing's settings (MapCtx).

import type { GeoCity } from "./load";
import { labelOf, leftOf, narrowPeakSide, type MapCtx, type PeakSide, type Proj } from "./map-geometry";
import { esc, f1, overlaps, type Box } from "./svg";

/** An outpost's core cities joined, so it reads as one place. */
export function coreLinks({ region, geo, inside, pr }: MapCtx): string[] {
  if (region === "all") return [];
  const core = geo.cities.filter((c) => c.region === region && c.core && inside(c.lat, c.lon)).map((c) => pr.xy(c.lat, c.lon));
  const out: string[] = [];
  for (let i = 0; i < core.length; i += 1) {
    for (let j = i + 1; j < core.length; j += 1) {
      const [x1, y1] = core[i]!;
      const [x2, y2] = core[j]!;
      out.push(`<line class="sv-core-link" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`);
    }
  }
  return out;
}

/** Ute Pass: the route up from Manitou Springs to Woodland Park, drawn as a schematic line. */
export function utePass({ region, geo, inside, pr }: MapCtx): string[] {
  if (region !== "space-peak" && region !== "all") return [];
  const a = geo.cities.find((c) => c.name === "Manitou Springs");
  const b = geo.cities.find((c) => c.name === "Woodland Park");
  if (!a || !b || !inside(a.lat, a.lon) || !inside(b.lat, b.lon)) return [];
  const [x1, y1] = pr.xy(a.lat, a.lon);
  const [x2, y2] = pr.xy(b.lat, b.lon);
  const out = [`<path class="sv-route" d="M${f1(x1)} ${f1(y1)}Q${f1((x1 + x2) / 2 - 18)} ${f1((y1 + y2) / 2 + 6)} ${f1(x2)} ${f1(y2)}"/>`];
  if (region === "space-peak") {
    out.push(
      `<text class="sv-label sv-halo sv-route-label" x="${f1((x1 + x2) / 2 - 26)}" y="${f1((y1 + y2) / 2 - 10)}" text-anchor="end">Ute Pass</text>`,
    );
  }
  return out;
}

/** Landmarks, such as a canyon mouth, drawn as small diamonds. */
export function landmarkMarks({ region, geo, inside, pr }: MapCtx): string[] {
  return geo.landmarks
    .filter((lm) => (region === "all" || lm.region === undefined || lm.region === region) && inside(lm.lat, lm.lon))
    .flatMap((lm) => {
      const [x, y] = pr.xy(lm.lat, lm.lon);
      return [
        `<path class="sv-landmark" d="M${f1(x)} ${f1(y - 6)}L${f1(x + 6)} ${f1(y)}L${f1(x)} ${f1(y + 6)}L${f1(x - 6)} ${f1(y)}Z"/>`,
        `<text class="sv-label sv-halo sv-italic" x="${f1(x - 10)}" y="${f1(y + 4)}" text-anchor="end">${esc(lm.name)}</text>`,
      ];
    });
}

/** Peaks. The statewide phone map keeps the markers and leaves their names to the description: at 310 units they would crowd the outposts'. */
export function peakMarks({ region, narrow, geo, inside, pr }: MapCtx): string[] {
  const out: string[] = [];
  for (const p of geo.peaks) {
    if (!inside(p.lat, p.lon)) continue;
    const [x, y] = pr.xy(p.lat, p.lon);
    out.push(`<path class="sv-peak" d="M${f1(x - 9)} ${f1(y + 6)}L${f1(x)} ${f1(y - 9)}L${f1(x + 9)} ${f1(y + 6)}Z"/>`);
    if (!(narrow && region === "all")) out.push(peakLabel(p.name, x, y, narrow, pr.W));
  }
  return out;
}

/** A peak's name. A hanging baseline keeps the label's top under the marker at any font size. */
function peakLabel(name: string, x: number, y: number, narrow: boolean, W: number): string {
  // On a phone drawing a peak near an edge keeps its label inside (about 8 units a letter).
  const half = (name.length * 8) / 2 + 4;
  const lx = narrow ? Math.min(Math.max(x, half), W - half) : x;
  const side: PeakSide = narrow ? narrowPeakSide(name, false) : "south";
  if (side === "west") return `<text class="sv-label sv-halo sv-italic" x="${f1(x - 13)}" y="${f1(y + 5)}" text-anchor="end">${esc(name)}</text>`;
  if (side === "north") return `<text class="sv-label sv-halo sv-italic" x="${f1(lx)}" y="${f1(y - 14)}" text-anchor="middle">${esc(name)}</text>`;
  return `<text class="sv-label sv-halo sv-italic" x="${f1(lx)}" y="${f1(y + 10)}" text-anchor="middle" dominant-baseline="hanging">${esc(name)}</text>`;
}

/** What each peak's marker and label cover, so the inset can find a free corner. */
export function peakBoxes({ region, narrow, geo, inside, pr }: MapCtx): Box[] {
  return geo.peaks
    .filter((p) => inside(p.lat, p.lon))
    .map((p): Box => {
      const [x, y] = pr.xy(p.lat, p.lon);
      if (narrow && region === "all") return [x - 10, y - 10, x + 10, y + 7];
      const side: PeakSide = narrow ? narrowPeakSide(p.name, false) : "south";
      const span = p.name.length * 8;
      if (side === "west") return [x - 13 - span, y - 12, x + 9, y + 10];
      if (side === "north") return [x - span / 2, y - 30, x + span / 2, y + 6];
      return [x - 46, y - 12, x + 46, y + 30];
    });
}

/** True for a point at least 10 units inside the drawing's frame. */
const clearOfFrame = (x: number, y: number, pr: Proj) => x > 10 && x < pr.W - 10 && y > 10 && y < pr.H - 10;

/** Cities: this view's towns as markers with labels, other outposts' as dim dots. Each label's box joins `taken`. */
export function cityMarks(m: MapCtx, taken: Box[]): string[] {
  const { region, narrow, geo, inside, pr } = m;
  const out: string[] = [];
  for (const c of geo.cities) {
    if (!inside(c.lat, c.lon)) continue;
    const [x, y] = pr.xy(c.lat, c.lon);
    if (region === "all" || c.region === region) {
      out.push(...cityMarker(m, c, x, y, taken));
      continue;
    }
    // A dot on the frame edge reads as a stray mark. A phone drawing leaves
    // other outposts' towns out: at 310 units they only crowd the names.
    if (!narrow && clearOfFrame(x, y, pr)) out.push(`<circle class="sv-dim" cx="${f1(x)}" cy="${f1(y)}" r="3"/>`);
  }
  return out;
}

/** One town of this view: a strong marker and label, or a small dot labelled on an outpost's map. */
function cityMarker({ region, narrowKind, strong }: MapCtx, c: GeoCity, x: number, y: number, taken: Box[]): string[] {
  const [dx, dy, anchor] = labelOf(c.name, narrowKind);
  const span = c.name.length * 12 + 10;
  const lx0 = anchor === "start" ? x + dx - 10 : leftOf(x + dx, span, anchor);
  taken.push([lx0, y - 18, lx0 + span + (anchor === "start" ? 10 : 0), y + 20]);
  const text = (cls: string) => `<text class="${cls} sv-halo" x="${f1(x + dx)}" y="${f1(y + dy)}" text-anchor="${anchor}">${esc(c.name)}</text>`;
  if (strong(c)) return [`<circle class="sv-city-core" cx="${f1(x)}" cy="${f1(y)}" r="7"/>`, text("sv-label-strong")];
  const dot = `<circle class="sv-city" cx="${f1(x)}" cy="${f1(y)}" r="3.8"/>`;
  return region === "all" ? [dot] : [dot, text("sv-label")];
}

/** The inset: where this view sits in Colorado. The first corner clear of every marker and label wins. */
export function inset({ region, narrow, geo, pr }: MapCtx, taken: readonly Box[]): string[] {
  const { W, H } = pr;
  const sb = geo.state_bounds;
  const iw = narrow ? 64 : 92;
  const ih = (iw * (sb.north - sb.south)) / ((sb.east - sb.west) * Math.cos(39 * (Math.PI / 180)));
  const below = region === "all" ? 34 : 14;
  const corners: readonly (readonly [number, number])[] = [
    [14, H - ih - below],
    [14, 40],
    [W - iw - 14, H - ih - below],
  ];
  const clear = ([ix, iy]: readonly [number, number]) => !taken.some((b) => overlaps([ix - 4, iy - 26, ix + iw + 4, iy + ih + below], b));
  const [ix, iy] = corners.find(clear) ?? corners[0]!;
  const bx0 = ix + ((pr.west - sb.west) / (sb.east - sb.west)) * iw;
  const bx1 = ix + ((pr.east - sb.west) / (sb.east - sb.west)) * iw;
  const by0 = iy + ((sb.north - pr.north) / (sb.north - sb.south)) * ih;
  const by1 = iy + ((sb.north - pr.south) / (sb.north - sb.south)) * ih;
  const out = [
    `<rect class="sv-inset" x="${f1(ix)}" y="${f1(iy)}" width="${f1(iw)}" height="${f1(ih)}" rx="2"/>`,
    `<rect class="sv-inset-view" x="${f1(bx0)}" y="${f1(by0)}" width="${f1(bx1 - bx0)}" height="${f1(by1 - by0)}"/>`,
    `<text class="sv-label sv-small sv-halo" x="${f1(ix + iw / 2)}" y="${f1(iy - 5)}" text-anchor="middle">Colorado</text>`,
  ];
  if (region === "all") {
    out.push(
      `<rect class="sv-inset-frame" x="${f1(ix - 3)}" y="${f1(iy - 3)}" width="${f1(iw + 6)}" height="${f1(ih + 6)}" rx="3"/>`,
      `<text class="sv-label sv-small sv-halo sv-bold" x="${f1(ix)}" y="${f1(iy + ih + 20)}" text-anchor="start">Slack seat: statewide</text>`,
    );
  }
  return out;
}

/** The north arrow, top right. */
export const northArrow = (W: number) =>
  `<g transform="translate(${f1(W - 26)} 30)"><path class="sv-north" d="M0 -14L6 6L0 2L-6 6Z"/>` +
  `<text class="sv-label sv-small sv-halo sv-bold" y="20" text-anchor="middle">N</text></g>`;
