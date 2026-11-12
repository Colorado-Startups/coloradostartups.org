// Observable Plot rendered to an SVG string at build time, in Node, through
// one JSDOM document: the Leaderboard charts (leaderboard/charts.ts) and the
// /regions/ map (regions/map.ts). No `tip` marks: they need a live browser
// layout and fail under JSDOM (PLAN.md, Leaderboard). No client JavaScript
// ships for either.

import * as Plot from "@observablehq/plot";
import { JSDOM } from "jsdom";

// Chart and map text is the type scale's smallest step, 15 px (brand_tokens.yaml).
const STYLE = { background: "transparent", color: "var(--c-text)", fontSize: "var(--t-step--1)", overflow: "visible" };

let doc: Document | undefined;
function document(): Document {
  if (!doc) doc = new JSDOM("<!doctype html><html><body></body></html>").window.document;
  return doc;
}

// The figure is one image to assistive tech: role="img" with the label Plot
// sets on the root. Plot also labels each mark group (<g aria-label="bar">),
// which ARIA prohibits on role-less elements (axe aria-prohibited-attr), so
// those are removed. The figcaption and data table carry the full text
// alternative.
/** One Plot figure as an SVG string, in the site's chart style. */
export function renderPlot(options: Plot.PlotOptions): string {
  const svg = Plot.plot({ ...options, document: document(), style: STYLE }) as unknown as Element;
  svg.setAttribute("role", "img");
  for (const el of svg.querySelectorAll("[aria-label]")) el.removeAttribute("aria-label");
  return svg.outerHTML;
}

export interface ChartText {
  /** Short accessible name for the SVG. */
  label: string;
  /** One or two sentences a screen reader hears instead of the picture. */
  description: string;
}
