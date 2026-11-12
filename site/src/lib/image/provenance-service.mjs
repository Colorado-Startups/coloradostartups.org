// @ts-check
// The site's image service: Astro's sharp service, plus each art file's
// provenance. Astro re-encodes every <Image> width and drops all metadata, so
// a visitor's copy of the Hall art carried none (card "Served art keeps its
// provenance XMP"). This service writes the source WebP's provenance record
// into each WebP it makes. It splices the RIFF chunk (art/tools/provenance.mjs),
// so no picture is encoded twice. It never copies the source's bytes: it reads
// the nine fields make-finals.mjs writes and rebuilds the packet from them.
import sharpService from "astro/assets/services/sharp";

import { readWebpXmp, setWebpXmp, xmpPacket } from "../../../../art/tools/provenance.mjs";

// Location properties of EXIF, IPTC and Photoshop, as an element or an
// attribute. The rebuilt packet carries none; this is a second check.
const PLACE_FIELD = /\b(exif:GPS\w*|Iptc4xmpExt:Location\w*|Iptc4xmpCore:Location|photoshop:(City|State|Country))\b/;

const UNESCAPE = /** @type {Record<string, string>} */ ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" });

/** The text of the one `<name>` element in `xmp`, unescaped, or undefined. */
function field(/** @type {string} */ xmp, /** @type {string} */ name) {
  const m = xmp.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].replace(/&(amp|lt|gt|quot|apos);/g, (e) => UNESCAPE[e]) : undefined;
}

/** @param {Uint8Array} buf */
function isWebp(buf) {
  const head = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 12));
  return head.length === 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
}

/**
 * The provenance packet to write into the source's variants, or null. The
 * packet is rebuilt from its nine fields with xmpPacket(), and ships only when
 * the rebuild equals the source byte for byte: any other element, attribute
 * or namespace (a creator, a person, a place, an edit history) refuses it.
 * Throws on a malformed WebP.
 * @param {Uint8Array} source
 * @returns {string | null}
 */
export function provenanceXmp(source) {
  if (!isWebp(source)) return null;
  const xmp = readWebpXmp(Buffer.from(source));
  if (xmp === null) return null;
  const system = field(xmp, "Iptc4xmpExt:AISystemUsed")?.match(/^(.*) \(([^()]*)\)$/);
  const seed = Number(field(xmp, "cs:Seed"));
  if (!system || !Number.isInteger(seed)) return null;
  const rebuilt = xmpPacket({
    model: system[1],
    maker: system[2],
    version: field(xmp, "Iptc4xmpExt:AISystemVersionUsed"),
    prompt: field(xmp, "Iptc4xmpExt:AIPromptInformation"),
    negative: field(xmp, "cs:NegativePrompt"),
    seed,
    license: field(xmp, "cs:ModelLicense"),
    license_url: field(xmp, "cs:ModelLicenseURL"),
    source: field(xmp, "cs:Source"),
  });
  return rebuilt === xmp && !PLACE_FIELD.test(rebuilt) ? rebuilt : null;
}

/** @type {import("astro").LocalImageService} */
const provenanceService = {
  ...sharpService,
  async transform(inputBuffer, transform, config, logger) {
    const out = await sharpService.transform(inputBuffer, transform, config, logger);
    if (out.format !== "webp") return out;
    // A malformed source or variant must not break the build: the variant
    // ships as Astro made it, without the record, and the build log says so.
    try {
      const xmp = provenanceXmp(inputBuffer);
      return xmp ? { ...out, data: setWebpXmp(Buffer.from(out.data), xmp) } : out;
    } catch (e) {
      logger.warn(`${transform.src}: no provenance XMP in its variants (${e instanceof Error ? e.message : e})`);
      return out;
    }
  },
};

export default provenanceService;
