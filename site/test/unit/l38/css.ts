// L38 test helpers: read seats.css the way a browser would for the few
// properties the seat tests compute (#367, #231, #234). Not a CSS engine:
// single-class selectors of equal weight, plain rules and
// @media (max-width: Nrem) blocks only, and the grid track forms seats.css
// uses. Anything else throws, so a new form fails loudly instead of passing.
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), "utf8");

/** seats.css without its comments. */
export const SEATS_CSS = read("components/seats/seats.css").replace(/\/\*[\s\S]*?\*\//g, "");
export const GLOBAL_CSS = read("styles/global.css");
const TOKENS = read("styles/tokens.css");

/**
 * The widest .wrap, in px: global.css gives it as a length or, since the
 * design-system pass, as the --size-wrap token. lengthPx resolves either and
 * throws on anything else, because a NaN here would let every width check
 * pass without checking anything (#487).
 */
export const WRAP_MAX = lengthPx(/\.wrap \{\s*width: min\(100% - 2 \* var\(--s-5\), ([^;]+)\);/.exec(GLOBAL_CSS)?.[1] ?? "missing");
/** The page's gutters, both sides, in px: global.css .wrap is 100% - 2 * --s-5. */
export const GUTTERS = 48;
/** The .wrap width on a screen `screen` px wide. */
export const wrapAt = (screen: number) => Math.min(screen - GUTTERS, WRAP_MAX);

/** A length in px: a rem or px value, or a var() of a rem or px token. Throws on anything else. */
export function lengthPx(value: string): number {
  const token = /^var\(--([\w-]+)\)$/.exec(value.trim())?.[1];
  const raw = token ? new RegExp(`--${token}:\\s*([\\d.]+(?:rem|px));`).exec(TOKENS)?.[1] : value.trim();
  if (raw === "0") return 0;
  const m = /^([\d.]+)(rem|px)$/.exec(raw ?? "");
  if (!m) throw new Error(`not a length: ${value}`);
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1);
}

/** A CSS file in source order: each plain rule, and each @media (max-width) block with its rules. */
export const BLOCKS = /@media \(max-width: ([\d.]+)rem\) \{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;

/**
 * The declarations, in cascade order, that rules naming any of `selectors`
 * give on a screen `width` px wide: the rules outside @media plus those whose
 * max-width covers the screen. Pass the selectors weakest first; a later
 * declaration wins.
 */
export function declsAt(css: string, width: number, selectors: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  const take = (selector: string, body: string) => {
    if (!selector.split(",").some((s) => selectors.includes(s.trim().replace(/\s+/g, " ")))) return;
    for (const d of body.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out.push([d.slice(0, i).trim(), d.slice(i + 1).trim()]);
    }
  };
  for (const m of css.matchAll(BLOCKS)) {
    if (m[1] !== undefined) {
      if (Number(m[1]) * 16 >= width) for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) take(r[1]!, r[2]!);
    } else take(m[3]!, m[4]!);
  }
  return out;
}

/** The winning value of `property` among `decls`. */
export const valueOf = (decls: readonly [string, string][], property: string) => decls.filter(([p]) => p === property).at(-1)?.[1];

/** The winning top padding among `decls`, from padding, padding-block or padding-top, in px. */
export function paddingTopPx(decls: readonly [string, string][]): number {
  const last = decls.filter(([p]) => p === "padding" || p === "padding-block" || p === "padding-top").at(-1);
  return last ? lengthPx(last[1].split(/\s+/)[0]!) : 0;
}

/** The px width of each column of an explicit grid `wrap` px wide: fixed tracks, then 1fr tracks sharing what is left. */
export function columnsPx(template: string, wrap: number, gap: number): number[] {
  const expanded = template.replace(/repeat\((\d+),\s*(minmax\([^()]*\)|[^()\s]+)\)/g, (_, n: string, t: string) => Array(Number(n)).fill(t).join(" "));
  const tracks = expanded.match(/minmax\([^()]*\)|[^\s]+/g) ?? [];
  const isFr = (t: string) => /^(?:minmax\(0,\s*)?1fr\)?$/.test(t);
  const fixed = tracks.filter((t) => !isFr(t)).reduce((sum, t) => sum + lengthPx(t), 0);
  const fr = (wrap - fixed - gap * (tracks.length - 1)) / tracks.filter(isFr).length;
  return tracks.map((t) => (isFr(t) ? fr : lengthPx(t)));
}

/**
 * How `items` lay out in a grid `wrap` px wide: the tracks in a row, each
 * track's width, and how far the first row reaches. Takes an explicit
 * template or repeat(auto-fit | auto-fill, minmax(min(100%, L), 1fr)):
 * auto-fill keeps its empty tracks, auto-fit drops them.
 */
export function gridRow(template: string, wrap: number, gap: number, items: number): { tracks: number; track: number; reach: number } {
  const auto = /^repeat\((auto-fit|auto-fill),\s*minmax\(min\(100%,\s*([\d.]+(?:rem|px))\),\s*1fr\)\)$/.exec(template);
  if (!auto) {
    const cols = columnsPx(template, wrap, gap);
    const used = Math.min(cols.length, items);
    return { tracks: cols.length, track: cols[0]!, reach: cols.slice(0, used).reduce((s, c) => s + c, 0) + gap * (used - 1) };
  }
  const min = Math.min(lengthPx(auto[2]!), wrap);
  const fill = Math.max(1, Math.floor((wrap + gap) / (min + gap)));
  const tracks = auto[1] === "auto-fit" ? Math.min(fill, items) : fill;
  const track = (wrap - gap * (tracks - 1)) / tracks;
  const used = Math.min(tracks, items);
  return { tracks, track, reach: used * track + gap * (used - 1) };
}
