// L6: provenance for the shipped art (art/tools/provenance.mjs). Every shipped
// WebP carries its model, version, license, prompt and seed as XMP, written
// without re-encoding, and make-finals refuses a source whose maker's
// provenance a re-encode would drop.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { tempDirs } from "../temp-dirs";
import { provenancePackets, shippedFiles, sourcePath, sourcesWithProvenance, stampShipped } from "../../../../art/tools/make-finals.mjs";
import {
  AI_SOURCE,
  PROMPT_READERS,
  pngProvenance,
  provenanceFor,
  readWebpXmp,
  setWebpXmp,
  webpChunks,
  xmpPacket,
} from "../../../../art/tools/provenance.mjs";

const ROOT = path.join(__dirname, "../../../..");
const plan = JSON.parse(readFileSync(path.join(ROOT, "art/finals.json"), "utf8"));
const tmp = tempDirs();

const MODELS = {
  image_anima_base_v1: { name: "Anima Base", maker: "CircleStone Labs", version: "v1.0", license: "Anima license v1.2", license_url: "https://example.org/l" },
};
const animaBatch = {
  template: "image_anima_base_v1",
  items: [{ description: "hero-a", slot_overrides: { "90.text": "A hall & <its> \"lanterns\"", "90.text_1": "dark", "90.seed": 7 } }],
};

async function pixels(buf: Buffer) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

describe("records", () => {
  it("reads the prompt and seed each template keeps, and names what is missing", () => {
    const rec = provenanceFor({ batch: 1, from: "hero-a" }, animaBatch, MODELS);
    expect(rec).toMatchObject({ model: "Anima Base", seed: 7, negative: "dark", source: "art/runs/batch-1.json#hero-a" });
    expect(provenanceFor({ batch: 1, from: "hero-z" }, animaBatch, MODELS)).toMatch(/no render hero-z/);
    expect(provenanceFor({ batch: 1, from: "hero-a" }, animaBatch, {})).toMatch(/models has no image_anima_base_v1/);
    expect(provenanceFor({ batch: 3, from: "x" }, { template: "image_other", items: [] }, MODELS)).toMatch(/no prompt reader/);
  });

  it("reads a FIBO 2.0 render's VGL caption, or its plain prompt when there is no caption", () => {
    const node = (o: object) => ({ input_overrides: { "1": o } });
    expect(PROMPT_READERS.api_bria_fibo2_t2i(node({ structured_prompt: '{"a":1}', prompt: "", seed: 9 }))).toEqual({ prompt: '{"a":1}', seed: 9 });
    expect(PROMPT_READERS.api_bria_fibo2_t2i(node({ structured_prompt: "", prompt: "a passage", seed: 9 }))).toEqual({ prompt: "a passage", seed: 9 });
  });

  it("builds a record for every file art/finals.json ships, finals and tiles", () => {
    const { packets, problems } = provenancePackets(plan);
    expect(problems).toEqual([]);
    expect(Object.keys(packets).sort()).toEqual(shippedFiles(plan).map((s: { out: string }) => s.out).sort());
  });
});

describe("xmpPacket", () => {
  const rec = provenanceFor({ batch: 1, from: "hero-a" }, animaBatch, MODELS) as Record<string, unknown>;
  const xmp = xmpPacket(rec);

  it("labels the file as trained-model media in IPTC's fields, and keeps seed and license", () => {
    expect(xmp).toContain(`<Iptc4xmpExt:DigitalSourceType>${AI_SOURCE}</Iptc4xmpExt:DigitalSourceType>`);
    expect(xmp).toContain("<Iptc4xmpExt:AISystemUsed>Anima Base (CircleStone Labs)</Iptc4xmpExt:AISystemUsed>");
    expect(xmp).toContain("<Iptc4xmpExt:AISystemVersionUsed>v1.0</Iptc4xmpExt:AISystemVersionUsed>");
    expect(xmp).toContain("<cs:Seed>7</cs:Seed>");
    expect(xmp).toContain("<cs:ModelLicenseURL>https://example.org/l</cs:ModelLicenseURL>");
  });

  it("escapes the prompt, and makes the same bytes from the same record", () => {
    expect(xmp).toContain("A hall &amp; &lt;its&gt; &quot;lanterns&quot;");
    expect(xmpPacket({ ...rec })).toBe(xmp);
  });
});

describe("setWebpXmp", () => {
  const raw = { create: { width: 37, height: 23, channels: 3 as const, background: "#C9AD7F" } };

  it("adds XMP to a lossy and a lossless WebP without touching a pixel", async () => {
    for (const encoded of [await sharp(raw).webp({ quality: 80 }).toBuffer(), await sharp(raw).webp({ lossless: true }).toBuffer()]) {
      const stamped = setWebpXmp(encoded, "<x>one</x>");
      expect(webpChunks(stamped)[0]).toBe("VP8X");
      expect(webpChunks(stamped).at(-1)).toBe("XMP ");
      expect(readWebpXmp(stamped)).toBe("<x>one</x>");
      const meta = await sharp(stamped).metadata();
      expect([meta.width, meta.height]).toEqual([37, 23]);
      expect(meta.xmp?.toString()).toBe("<x>one</x>");
      expect((await pixels(stamped)).data.equals((await pixels(encoded)).data)).toBe(true);
    }
  });

  it("replaces an old record rather than adding a second, and pads an odd-sized one", () => {
    const once = setWebpXmp(readFileSync(path.join(ROOT, "site/src/assets/art/textures/night-stone.webp")), "<x>odd!</x>");
    const twice = setWebpXmp(once, "<x>even</x>");
    expect(webpChunks(twice).filter((c: string) => c === "XMP ")).toHaveLength(1);
    expect(readWebpXmp(twice)).toBe("<x>even</x>");
    expect(once.length % 2).toBe(0);
    expect(once.readUInt32LE(4)).toBe(once.length - 8);
  });

  it("keeps the alpha flag of an image with transparency", async () => {
    const rgba = { create: { width: 8, height: 8, channels: 4 as const, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } };
    const stamped = setWebpXmp(await sharp(rgba).webp({ lossless: true }).toBuffer(), "<x/>");
    expect((await sharp(stamped).metadata()).hasAlpha).toBe(true);
  });
});

describe("source provenance", () => {
  // A PNG chunk, with a dummy CRC: pngProvenance reads types, not checksums.
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const withChunk = (png: Buffer, extra: Buffer) => Buffer.concat([png.subarray(0, 33), extra, png.subarray(33)]);

  it("ignores ComfyUI's prompt and workflow, and finds C2PA, EXIF and XMP", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
    const comfy = withChunk(png, chunk("tEXt", Buffer.from('prompt\0{"1":{"class_type":"SaveImage"}}')));
    expect(pngProvenance(comfy)).toEqual([]);
    expect(pngProvenance(withChunk(png, chunk("caBX", Buffer.from("jumb"))))).toEqual(["caBX"]);
    expect(pngProvenance(withChunk(png, chunk("eXIf", Buffer.from("MM\0*"))))).toEqual(["eXIf"]);
    expect(pngProvenance(withChunk(png, chunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x/>"))))).toEqual(["XMP"]);
  });

  it("make-finals lists every source that carries provenance", async () => {
    const inbox = tmp("l6-");
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
    for (const s of shippedFiles(plan)) {
      const file = sourcePath(inbox, s.batch, s.from);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, s.from === "hero-a" ? withChunk(png, chunk("caBX", Buffer.from("jumb"))) : png);
    }
    expect(sourcesWithProvenance(plan, inbox)).toEqual([{ file: sourcePath(inbox, 1, "hero-a"), found: ["caBX"] }]);
  });
});

describe("delivered art", () => {
  const { packets } = provenancePackets(plan);
  for (const s of shippedFiles(plan)) {
    it.skipIf(!existsSync(s.file))(`${s.out}.webp carries its own provenance record`, () => {
      expect(readWebpXmp(readFileSync(s.file))).toBe(packets[s.out]);
    });
  }

  it("--stamp finds every file before it writes any", () => {
    const dir = tmp("l6-");
    expect(stampShipped(plan, packets, dir)).toBe(3);
  });
});
