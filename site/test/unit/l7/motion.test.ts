// L7: idle motion ends within 5 seconds, so WCAG 2.2.2 (pause, stop, hide)
// needs no pause control. Checks every animation in the art components.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMBERS } from "../../../src/components/art/embers";

const DIR = path.join(__dirname, "../../../src/components/art");
const LIMIT = 5; // seconds, WCAG 2.2.2
const sources = readdirSync(DIR)
  .filter((f) => /\.(css|astro)$/.test(f))
  .map((f) => ({ f, text: readFileSync(path.join(DIR, f), "utf8") }));
const declarations = sources.flatMap(({ f, text }) =>
  [...text.matchAll(/animation:\s*([^;]+);/g)].map((m) => ({ f, value: m[1].trim() })),
);

// Seconds in a CSS time, reading the fallback of var(--x, 3.4s).
function seconds(token: string): number {
  const m = token.match(/(\d+(?:\.\d+)?)(ms|s)\)?$/);
  if (!m) return NaN;
  return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
}

// For each animation declaration, the chain of block headers around it.
function animationContexts(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: string[] = [];
  const found: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      stack.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (ch === "}") {
      stack.pop();
      start = i + 1;
    } else if (ch === ";") {
      start = i + 1;
    } else if (text.startsWith("animation:", i)) {
      found.push(stack.join(" > "));
    }
  }
  return found;
}

describe("idle motion", () => {
  it("finds the animations it checks", () => {
    expect(declarations.length).toBeGreaterThanOrEqual(3);
  });

  it("never loops forever", () => {
    for (const d of declarations) expect(d.value, d.f).not.toMatch(/infinite/);
  });

  it("ends within 5 seconds: duration times count, plus delay", () => {
    for (const d of declarations) {
      const parts = d.value.split(/\s+(?![^(]*\))/);
      const times = parts.filter((p) => /\d(?:ms|s)\)?$/.test(p)).map(seconds);
      const count = Number(parts.find((p) => /^\d+$/.test(p)) ?? 1);
      const [duration, delay = 0] = times;
      expect(Number.isFinite(duration), d.value).toBe(true);
      expect(duration * count + delay, `${d.f}: ${d.value}`).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("gives every ember a rise that ends within 5 seconds", () => {
    for (const e of EMBERS) expect(e.delay + e.duration).toBeLessThanOrEqual(LIMIT);
  });

  it("only animates inside prefers-reduced-motion: no-preference", () => {
    for (const { f, text } of sources) {
      for (const at of animationContexts(text)) expect(at, f).toMatch(/prefers-reduced-motion: no-preference/);
    }
  });
});
