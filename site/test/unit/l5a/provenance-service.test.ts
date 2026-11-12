// L5a: the image service writes each art file's provenance record into every
// variant (src/lib/image/provenance-service.mjs). Without it, Astro's sharp
// service drops the packet from every <Image> width. It rebuilds the packet
// from its nine fields, refuses anything else, and never breaks the build.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { readWebpXmp, setWebpXmp, webpChunks } from "../../../../art/tools/provenance.mjs";
import service, { provenanceXmp } from "../../../src/lib/image/provenance-service.mjs";

const SITE = path.join(__dirname, "../../..");
const hall = readFileSync(path.join(SITE, "src/assets/art/hero/hall.webp"));
// Team photos are personal data, so the public export leaves them out.
const PHOTO = path.join(SITE, "src/components/team/photos/paul-foley.webp");
const HAS_PHOTO = existsSync(PHOTO);
const photo = HAS_PHOTO ? readFileSync(PHOTO) : Buffer.alloc(0);
const png = readFileSync(path.join(SITE, "public/og/team.png"));
const packet = readWebpXmp(hall) ?? "";

// Astro passes its image config; the sharp service reads only these two.
const config = { service: { entrypoint: "", config: {} } } as never;

async function variant(source: Buffer, format: "webp" | "png" = "webp") {
  const warnings: string[] = [];
  const logger = { warn: (m: string) => warnings.push(m) } as never;
  const out = await service.transform!(source, { src: "art.webp", width: 640, format }, config, logger);
  return { data: Buffer.from(out.data), format: out.format, warnings };
}

/** The hero with its packet edited by `edit`. */
const withPacket = (edit: (p: string) => string) => setWebpXmp(hall, edit(packet));

describe("provenanceXmp", () => {
  it("rebuilds the art's own packet, byte for byte (known clean)", () => {
    expect(packet).toContain("Iptc4xmpExt:DigitalSourceType");
    expect(provenanceXmp(hall)).toBe(packet);
  });

  it("refuses any field outside the nine, and any place (known bad)", () => {
    const extra = (tag: string) => withPacket((p) => p.replace("  </rdf:Description>", `   ${tag}\n  </rdf:Description>`));
    expect(provenanceXmp(extra("<dc:creator>Jane Doe</dc:creator>"))).toBeNull();
    expect(provenanceXmp(extra("<Iptc4xmpExt:PersonInImage>Jane Doe</Iptc4xmpExt:PersonInImage>"))).toBeNull();
    expect(provenanceXmp(extra("<exif:GPSLatitude>39,44.6N</exif:GPSLatitude>"))).toBeNull();
    // A place as an attribute, not an element.
    expect(provenanceXmp(withPacket((p) => p.replace('rdf:about=""', 'rdf:about="" exif:GPSLatitude="39,44.6N"')))).toBeNull();
    // Another source type, or no source type at all.
    expect(provenanceXmp(withPacket((p) => p.replace("trainedAlgorithmicMedia", "digitalCapture")))).toBeNull();
    expect(provenanceXmp(withPacket((p) => p.replace(/ *<Iptc4xmpExt:DigitalSourceType>.*\n/, "")))).toBeNull();
  });

  it.skipIf(!HAS_PHOTO)("carries nothing from a photo or a PNG", () => {
    expect(provenanceXmp(photo)).toBeNull();
    expect(provenanceXmp(png)).toBeNull();
  });
});

describe("the image service", () => {
  it("writes the record into a WebP variant, as a valid extended WebP with no EXIF or ICC profile", async () => {
    const { data, format, warnings } = await variant(hall);
    expect(format).toBe("webp");
    expect(readWebpXmp(data)).toBe(packet);
    expect(data.readUInt32LE(4)).toBe(data.length - 8);
    expect(data.toString("ascii", 12, 16)).toBe("VP8X");
    expect(data[20]! & 0x04).toBe(0x04);
    expect(webpChunks(data)).not.toContain("EXIF");
    expect(webpChunks(data)).not.toContain("ICCP");
    expect((await sharp(data).metadata()).width).toBe(640);
    expect(warnings).toEqual([]);
  });

  it("makes the same bytes every time", async () => {
    expect((await variant(hall)).data.equals((await variant(hall)).data)).toBe(true);
  });

  it.skipIf(!HAS_PHOTO)("leaves a variant without XMP for a photo, a PNG source, a PNG variant or a refused packet", async () => {
    for (const source of [photo, png, withPacket((p) => p.replace("  </rdf:Description>", "   <dc:creator>Jane</dc:creator>\n  </rdf:Description>"))]) {
      const { data, format } = await variant(source);
      expect(format).toBe("webp");
      expect(webpChunks(data)).not.toContain("XMP ");
    }
    const { data, format } = await variant(hall, "png");
    expect(format).toBe("png");
    expect(data.includes("x:xmpmeta")).toBe(false);
  });

  it("warns and still returns a variant when the source WebP is corrupt", async () => {
    const corrupt = hall.subarray(0, hall.length - 4000);
    const { data, warnings } = await variant(corrupt);
    expect(data.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("no provenance XMP"))).toBe(true);
  });
});
