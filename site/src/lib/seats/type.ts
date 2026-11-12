// The type scale in px, read at build time from 01_doctrine/brand_tokens.yaml,
// the one source of design tokens (styles/tokens.css is generated from it).
// viz.ts sizes a phone drawing's label boxes from these: there a unit is a
// pixel, so a step's px are its labels' units, and a type-scale change moves
// the estimates with the CSS instead of drifting from it (#374).
import { parse } from "yaml";

import tokensYaml from "../../../../01_doctrine/brand_tokens.yaml?raw";

export type TypeStep = "step--1" | "step-0" | "step-1";

const SCALE = ((parse(tokensYaml) as { type?: Record<string, unknown> }).type ?? {}) as Record<string, unknown>;

/** A type step's size in px, at the browser's 16 px rem. */
export function typePx(step: TypeStep): number {
  const size = SCALE[step];
  const rem = typeof size === "string" ? /^([\d.]+)rem$/.exec(size)?.[1] : undefined;
  if (rem === undefined) throw new Error(`01_doctrine/brand_tokens.yaml: type.${step} is not a rem size`);
  return Number(rem) * 16;
}
