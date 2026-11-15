// L7: the texture tiles L12 asked for (art/tools/make-tiles.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { tempDirs } from "../temp-dirs";
import {
  TILES,
  checkTile,
  crossfade,
  encodeTile,
  optionValue,
  parsePicks,
  seamRatio,
  sourceFile,
} from "../../../../art/tools/make-tiles.mjs";

const tempDir = tempDirs();
const tmp = () => tempDir("l7-tiles-");

const ROOT = path.join(__dirname, "../../../..");
const MAKE_TILES = path.join(ROOT, "art/tools/make-tiles.mjs");
const run = (script: string, args: string[], cwd = tmp()) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
const tokens = YAML.parse(readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8"));
const colors = tokens.color as Record<string, string>;

// A smooth, seeded test field: no two runs differ, and it does not tile on its own.
function field(n: number): Float32Array {
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = Array.from({ length: 6 }, () => [rand() * 9 + 1, rand() * 9 + 1, rand() * 6.28]);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (const [fx, fy, ph] of waves) v += Math.sin((x / n) * fx * 6.28 + (y / n) * fy * 3.1 + ph);
      out[y * n + x] = 128 + v * 18 + (rand() - 0.5) * 10;
    }
  }
  return out;
}

describe("texture contract", () => {
  // brand_tokens.yaml wins over TILES; this fails when they drift. The block
  // arrives with L12's tokens, so on a branch without it there is nothing to compare.
  it.skipIf(!tokens.texture)("agrees with the floors and ceilings in brand_tokens.yaml", () => {
    type Entry = { floor?: string; ceiling?: string };
    for (const [name, data] of Object.entries(tokens.texture as Record<string, Entry>)) {
      const tile = TILES[name as keyof typeof TILES];
      expect(tile, name).toBeDefined();
      if (data.floor) expect(tile.floor, `${name} floor`).toBe(data.floor);
      if (data.ceiling) expect(tile.ceiling, `${name} ceiling`).toBe(data.ceiling);
    }
  });

  it("names every floor and ceiling by token, never by hex", () => {
    for (const [name, spec] of Object.entries(TILES)) {
      expect(spec.floor, name).not.toMatch(/^#/);
      expect(spec.ceiling, name).not.toMatch(/^#/);
    }
  });

  it("covers the three tiles L12 asked for", () => {
    expect(Object.keys(TILES).sort()).toEqual(["night-stone", "parchment", "stone"]);
  });
});

describe("crossfade", () => {
  it("makes the wrap neighbors adjacent source pixels", () => {
    const w = 10;
    const src = Float32Array.from({ length: w }, (_, i) => i * 10);
    const out = crossfade(src, w, 1, 6, "x");
    // Output 0 is source 6 (faded fully to the overhang) and output 5 is source 5.
    expect(out[0]).toBeCloseTo(60);
    expect(out[5]).toBeCloseTo(50);
  });
});

describe("makeTile", () => {
  for (const [name, spec] of Object.entries(TILES)) {
    it(`turns a test field into a ${name} tile with no wrap seam, inside its contract`, async () => {
      // Tests the method, not the contract: until L12's night-ceiling token is on
      // main, the night tile borrows its value from L12's PR #26.
      const palette = { ...colors, "night-ceiling": colors["night-ceiling"] ?? "#1E2E50" };
      const file = path.join(tempDir("l7-tile-"), `${name}.webp`);
      const result = await encodeTile(field(1024), 1024, file, spec, palette);
      expect(result.problems).toEqual([]);
      expect(result.seam).toBeLessThan(1.5);
      // Each case encodes a full 1024 px tile. Run alone, this file took 5.6 s
      // for its 11 tests (2026-10-18). Under the full suite and a parallel
      // build, one case ran past vitest's 5 s default and blocked pre-push.
      // The limit allows for load; it is not a speed target.
    }, 30_000);
  }

  it("flags a tile with a wrap seam", () => {
    const n = 64;
    const gray = Float32Array.from({ length: n * n }, (_, p) => (p % n) * 4);
    expect(seamRatio(gray, n)).toBeGreaterThan(10);
  });
});

describe("delivered tiles", () => {
  for (const [name, spec] of Object.entries(TILES)) {
    const file = path.join(ROOT, `site/src/assets/art/textures/${name}.webp`);
    it.skipIf(!existsSync(file))(`${name}.webp stays inside its contract`, async () => {
      const result = await checkTile(file, spec, colors);
      expect(result.problems).toEqual([]);
    });
  }
});

describe("make-tiles picks", () => {
  it("reads a render id from the inbox folder or a .png by path", () => {
    expect(parsePicks(["--from", "x", "--pick", "stone=tile-stone-2"])).toEqual({ stone: "tile-stone-2" });
    expect(sourceFile("/inbox/batch-2", "tile-stone-2")).toBe("/inbox/batch-2/tile-stone-2.png");
    expect(sourceFile("/inbox/batch-2", "/inbox/batch-1/tile-night-stone.png")).toBe("/inbox/batch-1/tile-night-stone.png");
  });

  it("refuses a tile that is not in the contract", () => {
    expect(() => parsePicks(["--pick", "marble=tile-marble-1"])).toThrow(/stone, parchment, night-stone/);
  });
});

describe("make-tiles option values", () => {
  it("reads a value, and reads nothing when the flag is absent", () => {
    expect(optionValue(["--from", "inbox", "--out", "dir"], "--out")).toBe("dir");
    expect(optionValue(["--from", "inbox"], "--out")).toBeUndefined();
  });

  it("refuses a flag with no value, or with another flag where its value should be", () => {
    expect(() => optionValue(["--from", "x", "--out"], "--out")).toThrow(/--out needs a value/);
    expect(() => optionValue(["--out", "--pick", "stone=a"], "--out")).toThrow(/--out needs a value/);
  });

  it("make-tiles exits 2 on --out with no value and writes nothing", () => {
    const cwd = tmp();
    for (const args of [["--from", "x", "--out"], ["--from", "x", "--out", "--pick", "stone=a"]]) {
      const r = run(MAKE_TILES, args, cwd);
      expect(r.status, args.join(" ")).toBe(2);
    }
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("make-tiles writes to the --out folder it is given", async () => {
    const from = tmp();
    const out = path.join(tmp(), "tiles");
    // A smooth seeded field, the same kind field() feeds the method above.
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const raw = Buffer.alloc(1024 * 1024);
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) raw[y * 1024 + x] = 128 + 30 * Math.sin(x / 37 + y / 53) + (rand() - 0.5) * 10;
    }
    for (const spec of Object.values(TILES)) {
      await sharp(raw, { raw: { width: 1024, height: 1024, channels: 1 } }).png().toFile(path.join(from, `${spec.source}.png`));
    }
    const r = run(MAKE_TILES, ["--from", from, "--out", out]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(readdirSync(out).sort()).toEqual(Object.keys(TILES).map((t) => `${t}.webp`).sort());
  }, 60_000);
});
