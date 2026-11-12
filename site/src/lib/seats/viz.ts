// SVG figures for the volunteer seat pages (lane L38), ported from the
// volunteer kit's kit/viz.py. Pure functions: data in, an SVG string out,
// rendered at build time with no client JavaScript.
//
//   frontRangeMap   the Front Range with the three outposts, from data/positions/geo.yaml (front-range.ts)
//   networkDiagram  the connector diagram for a seat (network.ts)
//   hoursBar        the Claude Academy course hours as one stacked bar
//   stepsTrail      the three steps to apply as waypoints on a trail
//
// Colors and type come from sv-* classes in components/seats/seats.css, set
// with the site's tokens. The map and the diagram also take { narrow: true }
// for a phone drawing, 310 units wide, which SeatBlock shows up to 45.625rem.
// The map and the diagram carry a <title> and a <desc>; the bar and the
// trail are aria-hidden, because the course table and
// the steps list beside them hold the same facts. Drawings carry no figures:
// distances go in labeled tiles and bars beside them, with their sources.
import { f1 } from "./svg";

export { frontRangeMap, type MapRegion } from "./front-range";
export { networkDiagram, type NetworkSeat } from "./network";
export { esc, PHONE_TYPE, SEAT_NARROW_WIDTH } from "./svg";

// ---- Course hours ---------------------------------------------------------------------------

/**
 * The course hours as one stacked bar, one segment per course in sv-seg-0
 * to sv-seg-3. aria-hidden: the course table beside it lists each length and
 * the total, so the bar repeats them for the eye only.
 */
export function hoursBar(hours: readonly number[]): string {
  const total = hours.reduce((n, h) => n + h, 0);
  if (!(total > 0)) throw new Error("hoursBar: no course hours");
  const W = 640;
  const H = 40;
  let x = 0;
  const out = [`<svg class="sv sv-hours" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`];
  hours.forEach((h, i) => {
    const w = (h / total) * W;
    out.push(`<rect class="sv-seg-${i % 4}" x="${f1(x)}" y="4" width="${f1(Math.max(w - 3, 2))}" height="32" rx="3"/>`);
    x += w;
  });
  out.push("</svg>");
  return out.join("");
}

// ---- Trail ----------------------------------------------------------------------------------

/**
 * The three steps to apply as waypoints climbing a ridge, ending at a flag.
 * aria-hidden: the steps list beside it carries the words. The waypoint
 * numerals are ordinals, not figures, and carry data-ordinal.
 */
export function stepsTrail(): string {
  const W = 720;
  const H = 150;
  const pts: readonly (readonly [number, number])[] = [
    [60, 128],
    [360, 82],
    [660, 34],
  ];
  const out = [
    `<svg class="sv sv-trail" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`,
    '<path class="sv-trail-ridge" d="M0 150L120 92L190 120L300 60L380 100L470 38L560 84L640 20L720 70V150Z"/>',
    '<path class="sv-trail-path" d="M30 140C140 140 200 100 360 82S560 60 690 26"/>',
  ];
  pts.forEach(([x, y], i) => {
    out.push(`<circle class="sv-waypoint" cx="${x}" cy="${y}" r="17"/>`);
    out.push(`<text class="sv-waypoint-num" x="${x}" y="${y + 6}" text-anchor="middle" data-ordinal="">${i + 1}</text>`);
  });
  out.push('<path class="sv-flag" d="M690 26V2L708 9L690 16"/>');
  out.push("</svg>");
  return out.join("");
}
