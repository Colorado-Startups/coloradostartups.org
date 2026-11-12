// L17: the shipped art finals (art/tools/make-finals.mjs, art/finals.json) and
// the batch 2 run request.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { tempDirs } from "../temp-dirs";
import { buildApi } from "../../../../art/tools/build-api.mjs";
import { build } from "../../../../art/tools/build-batch.mjs";
import {
  KINDS,
  anchorWarnings,
  checkFinal,
  inHueRange,
  insideDir,
  missingSources,
  planProblems,
  provenancePackets,
  replaceGround,
  sourcePath,
  webpChunks,
} from "../../../../art/tools/make-finals.mjs";
import { TILES, optionValue, parsePicks, sourceFile } from "../../../../art/tools/make-tiles.mjs";
import { setWebpXmp } from "../../../../art/tools/provenance.mjs";

const ROOT = path.join(__dirname, "../../../..");
const colors = YAML.parse(readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8")).color as Record<string, string>;
type Entry = { out: string; batch: number; from: string; kind: string; crop?: number[]; anchor?: string };
const plan = JSON.parse(readFileSync(path.join(ROOT, "art/finals.json"), "utf8")) as {
  ground: { token: string };
  anchors: Record<string, unknown>;
  tiles: Record<string, unknown>;
  finals: Entry[];
};
const tempDir = tempDirs();
const tmp = () => tempDir("l17-");
const MAKE_TILES = path.join(ROOT, "art/tools/make-tiles.mjs");
const MAKE_FINALS = path.join(ROOT, "art/tools/make-finals.mjs");
const run = (script: string, args: string[], cwd = tmp()) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

// An inbox holding an empty file for every source art/finals.json names.
function dummyInbox(): string {
  const inbox = tmp();
  const tiles = Object.entries(plan.tiles).filter(([k]) => !k.startsWith("_")) as [string, { batch: number; from: string }][];
  for (const { batch, from } of [...plan.finals, ...tiles.map(([, t]) => t)]) {
    const file = sourcePath(inbox, batch, from);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  return inbox;
}

describe("art/finals.json", () => {
  it("names its ground and every anchor by a token in brand_tokens.yaml", () => {
    expect(colors[plan.ground.token]).toBeDefined();
    for (const name of Object.keys(plan.anchors).filter((k) => !k.startsWith("_"))) expect(colors[name], name).toBeDefined();
  });

  it("gives every keeper a large and a small crop, each with a known kind", () => {
    for (const id of ["communitas", "resourcus", "publicus"]) {
      expect(plan.finals.find((e) => e.out === `agents/${id}`)?.kind).toBe("keeper-large");
      const small = plan.finals.find((e) => e.out === `agents/${id}-small`);
      expect(small?.kind).toBe("keeper-small");
      expect(plan.anchors[small?.anchor ?? ""], id).toBeDefined();
    }
    for (const e of plan.finals) expect(KINDS[e.kind as keyof typeof KINDS], e.out).toBeDefined();
  });

  it("picks a render for every texture tile in make-tiles.mjs's contract, and no other", () => {
    const tiles = Object.keys(plan.tiles).filter((k) => !k.startsWith("_"));
    expect(tiles.sort()).toEqual(Object.keys(TILES).sort());
  });

  it("crops each final to the ratio of the file it ships as", () => {
    for (const e of plan.finals.filter((x) => x.crop)) {
      const [, , w, h] = e.crop as number[];
      // A kind gives a fixed size (keepers) or only a ratio (scenes).
      const spec = KINDS[e.kind as keyof typeof KINDS] as { size: number[] | null; ratio?: number };
      const ratio = spec.size ? spec.size[0] / spec.size[1] : (spec.ratio as number);
      expect(w / h, e.out).toBeCloseTo(ratio, 3);
    }
  });
});

describe("replaceGround", () => {
  // A white ground, a dark ring, and white again inside the ring.
  function ringImage(n: number): Buffer {
    const buf = Buffer.alloc(n * n * 3, 255);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = Math.hypot(x - n / 2, y - n / 2);
        if (r > n * 0.3 && r < n * 0.36) buf.fill(30, (y * n + x) * 3, (y * n + x) * 3 + 3);
      }
    }
    return buf;
  }

  it("moves the ground reached from the border and leaves enclosed white alone", () => {
    const n = 64;
    const target = [253, 241, 216];
    const { rgb, share } = replaceGround(ringImage(n), n, n, target);
    const at = (x: number, y: number) => [...rgb.subarray((y * n + x) * 3, (y * n + x) * 3 + 3)];
    expect(at(0, 0)).toEqual(target);
    expect(at(n / 2, n / 2)).toEqual([255, 255, 255]);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.8);
  });
});

describe("checkFinal", () => {
  const packet = "<x:xmpmeta>a record</x:xmpmeta>";

  it("passes a WebP of the right size with its record, and flags EXIF, a missing record or a stale one", async () => {
    const dir = tmp();
    const raw = { create: { width: 320, height: 320, channels: 3 as const, background: "#F8E3B8" } };
    const clean = path.join(dir, "clean.webp");
    const bare = path.join(dir, "bare.webp");
    const dirty = path.join(dir, "dirty.webp");
    await sharp(raw).webp().toFile(bare);
    writeFileSync(clean, setWebpXmp(readFileSync(bare), packet));
    writeFileSync(dirty, setWebpXmp(await sharp(raw).withExif({ IFD0: { ImageDescription: "a prompt" } }).webp().toBuffer(), packet));
    expect((await checkFinal(clean, "keeper-small", packet)).problems).toEqual([]);
    expect(webpChunks(readFileSync(dirty))).toContain("EXIF");
    expect((await checkFinal(dirty, "keeper-small", packet)).problems.join()).toMatch(/EXIF/);
    expect((await checkFinal(bare, "keeper-small", packet)).problems.join()).toMatch(/no provenance XMP/);
    expect((await checkFinal(clean, "keeper-small", "another record")).problems.join()).toMatch(/not its record's/);
  });

  it("flags a keeper avatar of the wrong size", async () => {
    const file = path.join(tmp(), "small.webp");
    const bare = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#F8E3B8" } }).webp().toBuffer();
    writeFileSync(file, setWebpXmp(bare, packet));
    expect((await checkFinal(file, "keeper-small", packet)).problems.join()).toMatch(/not 320 x 320/);
  });
});

describe("anchor measure", () => {
  it("reads hue ranges that wrap through 0", () => {
    expect(inHueRange(350, [340, 20])).toBe(true);
    expect(inHueRange(10, [340, 20])).toBe(true);
    expect(inHueRange(200, [340, 20])).toBe(false);
    expect(inHueRange(187, [175, 250])).toBe(true);
  });

  it("is quiet when each anchor shows most on its own keeper, and warns when it does not", () => {
    const clean = { community: { community: 0.11, pine: 0.01 }, pine: { community: 0.01, pine: 0.12 } };
    expect(anchorWarnings(clean)).toEqual([]);
    const crossed = { community: { community: 0.11, pine: 0.01 }, pine: { community: 0.2, pine: 0.05 } };
    const warnings = anchorWarnings(crossed).join("\n");
    expect(warnings).toMatch(/pine: 5% at 64 px, under the 8% goal/);
    expect(warnings).toMatch(/the pine avatar shows as much community/);
  });
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

describe("option values (make-tiles and make-finals)", () => {
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
    // A smooth seeded field, the same kind textures.test.ts feeds the method.
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

describe("art/finals.json paths", () => {
  const ART = path.join(ROOT, "site/src/assets/art");

  it("accepts the plan on disk", () => {
    expect(planProblems(plan)).toEqual([]);
  });

  it("refuses an out, from or batch that could leave the art folder or is not a slug", () => {
    const bad = {
      finals: [
        { out: "../../../etc/x", batch: 1, from: "hero-a", kind: "hero" },
        { out: "agents/communitas", batch: 1, from: "../batch-2/x", kind: "keeper-large" },
        { out: "hero/hall", batch: "1", from: "hero-a", kind: "hero" },
        { out: "hero/hall", batch: 0, from: "hero-a", kind: "hero" },
      ],
      tiles: { stone: { batch: 1.5, from: "tile-stone-3" }, marble: { batch: 1, from: "a/b" } },
    };
    const problems = planProblems(bad).join("\n");
    expect(problems).toMatch(/finals\[0\]: out must be lowercase slugs/);
    expect(problems).toMatch(/finals\[1\]: from must be a slug/);
    expect(problems).toMatch(/finals\[2\]: batch must be a positive integer/);
    expect(problems).toMatch(/finals\[3\]: batch must be a positive integer/);
    expect(problems).toMatch(/tiles.stone: batch must be a positive integer/);
    expect(problems).toMatch(/tiles.marble: not a tile/);
    expect(problems).toMatch(/tiles.marble: from must be a slug/);
  });

  it("knows inside from outside", () => {
    expect(insideDir(ART, "agents/communitas.webp")).toBe(true);
    expect(insideDir(ART, "../og/home.png")).toBe(false);
    expect(insideDir(ART, "/etc/passwd")).toBe(false);
  });
});

describe("make-finals preflight", () => {
  it("finds every source before writing, and reports none missing for a full inbox", () => {
    expect(missingSources(plan, dummyInbox())).toEqual([]);
    expect(missingSources(plan, dummyInbox(), "1")).toEqual([]);
  });

  it("lists every missing source and a missing previews folder", () => {
    const inbox = tmp();
    const missing = missingSources(plan, inbox, "9");
    expect(missing).toContain(sourcePath(inbox, 1, "hero-a"));
    expect(missing).toContain(sourcePath(inbox, 2, "region-fusion-canyon-2"));
    expect(missing).toContain(path.join(inbox, "batch-9"));
  });

  // Each run below stops before writing, so the shipped art is never touched.
  const shipped = () => plan.finals.map((e) => path.join(ROOT, `site/src/assets/art/${e.out}.webp`)).filter(existsSync).map((f) => statSync(f).mtimeMs);

  it("make-finals exits 3 on a missing source and writes nothing", () => {
    const before = shipped();
    const r = run(MAKE_FINALS, ["--from", tmp()]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/nothing was written/);
    expect(shipped()).toEqual(before);
  });

  it("make-finals exits 3 when --previews names a batch folder that is not there", () => {
    const before = shipped();
    const r = run(MAKE_FINALS, ["--from", dummyInbox(), "--previews", "9"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/missing .*batch-9/);
    expect(shipped()).toEqual(before);
  });

  it("make-finals exits 2 on --from with no value", () => {
    expect(run(MAKE_FINALS, ["--from"]).status).toBe(2);
    expect(run(MAKE_FINALS, ["--from", "--previews", "1"]).status).toBe(2);
  });
});

describe("delivered finals", () => {
  const { packets } = provenancePackets(plan);
  for (const e of plan.finals) {
    const file = path.join(ROOT, `site/src/assets/art/${e.out}.webp`);
    it.skipIf(!existsSync(file))(`${e.out}.webp has its size and its provenance record, and no other metadata`, async () => {
      expect((await checkFinal(file, e.kind, packets[e.out])).problems).toEqual([]);
    });
  }
});

// Generated files are pinned: what is on disk must be what the builders write.
describe("batch 2", () => {
  it("batch-2.json equals build('2')", () => {
    const onDisk = JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-2.json"), "utf8"));
    expect(onDisk).toEqual(build("2"));
  });

  it("batch-2.api.json equals buildApi('2')", () => {
    const onDisk = JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-2.api.json"), "utf8"));
    expect(onDisk).toEqual(buildApi("2"));
  });

  it("states Fusion Canyon's subject first: the small sun in brass coils, then the founders", () => {
    const req = build("2");
    for (const item of req.items.filter((i: { description: string }) => i.description.startsWith("region-fusion-canyon"))) {
      const body = item.slot_overrides["90.text"].split("\n")[1];
      expect(body).toMatch(/^A small bright artificial sun/);
      expect(body.indexOf("founders")).toBeGreaterThan(-1);
      expect(body.indexOf("founders")).toBeLessThan(body.indexOf("canyon"));
    }
  });
});
