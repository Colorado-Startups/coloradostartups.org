// The pieces every seat figure shares (viz.ts, front-range.ts, network.ts):
// escaping, number format, label boxes and the svg element's opening tag.

import { typePx } from "./type";

// A phone drawing's label sizes in units, for its layout estimates. Its unit is
// a pixel, so each is the type step seats.css gives the class (#374).
export const PHONE_TYPE = {
  label: typePx("step--1"), // .sv-label
  strong: typePx("step-0"), // .sv-label-strong
  center: typePx("step-1"), // .sv .sv-center
} as const;

/** Text and attribute values, escaped like Python's html.escape. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// A coordinate with one decimal, as the kit wrote them.
export const f1 = (n: number) => n.toFixed(1);

// A box as [x0, y0, x1, y1], for keeping labels and markers apart.
export type Box = readonly [number, number, number, number];
// True when two boxes share any area.
export const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// Phone drawings (#329). A 375 px phone showed the 680-unit figures 327 px
// wide, so their labels drew under the type scale. These are drawn 310 units
// wide and shown at that width (seats.css), so a unit is a pixel and their
// labels take the scale's own sizes. With the figure's 1 px border that is
// 312 px, the column of a 360 px screen. Their ids end in "-n", so a page
// that carries both drawings has no duplicate id.
export const SEAT_NARROW_WIDTH = 310;
export interface FigureOptions {
  /** Draw the phone version. */
  narrow?: boolean;
}

/** The svg element's opening tag: classes, the viewBox, a phone drawing's own size, and its labelledby ids. */
export function openSvg(classes: string, W: number, H: number, ids: string, narrow: boolean): string {
  const size = narrow ? ` width="${W.toFixed(0)}" height="${H.toFixed(0)}"` : "";
  return `<svg class="${classes}${narrow ? " sv--narrow" : ""}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}"${size} role="img" aria-labelledby="${ids}">`;
}
