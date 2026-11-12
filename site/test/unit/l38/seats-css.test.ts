import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stepsTrail } from "../../../src/lib/seats/viz";

// Every font size on the seat pages comes from the type scale (#120): a
// --t-step token, a clamp() that tops out at one, or an em relative to one.
// The SVG figures' labels were raw pixels, which the design check reads as
// off the scale.

const CSS = readFileSync(new URL("../../../src/components/seats/seats.css", import.meta.url), "utf8");

function offScale(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/font-size:\s*([^;]+);/g)]
    .map((m) => m[1]!.trim())
    .filter((v) => !/^var\(--t-step-{1,2}\d\)$/.test(v) && !/^clamp\(.*var\(--t-step-\d\)\)$/.test(v) && !/^\d*\.?\d+em$/.test(v));
}

describe("seats.css font sizes", () => {
  it("self-test: flags pixel sizes and passes tokens and ems", () => {
    expect(offScale(".a { font-size: 17px; } .b { font-size: var(--t-step-0); } .c { font-size: 0.7em; }")).toEqual(["17px"]);
  });

  it("are all on the type scale", () => {
    expect(offScale(CSS)).toEqual([]);
  });
});

// The steps trail's numbers draw at their units x the trail's drawn width /
// 720. They hide wherever that would fall under 15 px (#329). Computed from
// the token and the trail's width, with the page's 24 px gutters.
describe("the steps trail's numbers", () => {
  const text = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = readFileSync(new URL("../../../src/styles/tokens.css", import.meta.url), "utf8");
  const px = (token: string) => Number(new RegExp(`--${token}:\\s*([\\d.]+)rem`).exec(tokens)?.[1]) * 16;
  const size = /\.sv \.sv-waypoint-num \{[^}]*font-size:\s*var\(--(t-step-[\d-]+)\)/.exec(text)?.[1] ?? "";
  const width = Number(/viewBox="0 0 ([\d.]+) /.exec(stepsTrail())?.[1]);
  const hideBelow = Number(/@media \(max-width:\s*([\d.]+)rem\)\s*\{\s*\.sv \.sv-waypoint-num \{\s*display:\s*none/.exec(text)?.[1]) * 16;

  it("self-test: reads the number's token, the trail's width and the hiding rule", () => {
    expect(px(size)).toBe(18);
    expect(width).toBe(720);
    expect(hideBelow).toBeGreaterThan(0);
  });

  it("hide on every screen where they would draw under 15 px", () => {
    const smallestShown = width * (15 / px(size)) + 48; // screen width at which they reach 15 px
    expect(hideBelow).toBeGreaterThanOrEqual(smallestShown);
  });
});
