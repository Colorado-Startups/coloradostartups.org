// Provenance for every shipped art file: the model that made it, its version
// and license, and the prompt and seed it ran with. make-finals.mjs writes it
// into each WebP as XMP, in IPTC's fields where IPTC has one (Photo Metadata
// 2025.1: DigitalSourceType, AISystemUsed, AISystemVersionUsed,
// AIPromptInformation) and in the cs: namespace for the rest.
//
// The record comes from art/finals.json (which render ships as which file and
// the models block) and art/runs/batch-<n>.json (each render's prompt and
// seed). Writing it edits the WebP's RIFF chunks and never re-encodes, so the
// pixels stay byte for byte the same.
//
// The site's image service (site/src/lib/image/provenance-service.mjs, #668)
// rebuilds this packet from its fields and writes it into every <Image>
// variant, so a visitor's copy carries it too. That service imports xmpPacket,
// readWebpXmp and setWebpXmp, and ships a packet only when its rebuild equals
// the source byte for byte: change the packet's shape there in the same PR.

import fs from "node:fs";
import path from "node:path";

// IPTC's term for media a trained AI model made (cv.iptc.org, read 2026-11-03).
export const AI_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  Iptc4xmpExt: "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
  cs: "https://coloradostartups.org/ns/art/1.0/",
};

// Where each template keeps a render's prompts and seed in a batch item
// (art/runs/README.md). A batch whose template is missing here has no record.
export const PROMPT_READERS = {
  image_anima_base_v1: (item) => ({
    prompt: item.slot_overrides?.["90.text"],
    negative: item.slot_overrides?.["90.text_1"],
    seed: item.slot_overrides?.["90.seed"],
  }),
  // Bria's node takes a VGL caption in structured_prompt, or plain words in prompt.
  api_bria_fibo2_t2i: (item) => {
    const node = item.input_overrides?.["1"] ?? {};
    return { prompt: node.structured_prompt || node.prompt, seed: node.seed };
  },
  // Bria's Hugging Face Space takes the same caption as json_prompt.
  hf_space_fibo2_t2i: (item) => ({ prompt: item.inputs?.json_prompt, seed: item.inputs?.seed }),
};

export function loadBatch(root, batch) {
  return JSON.parse(fs.readFileSync(path.join(root, "art/runs", `batch-${batch}.json`), "utf8"));
}

// One render's record, from its batch file and the models block. Returns a
// string saying what is missing when the record cannot be built.
export function provenanceFor({ batch, from }, batchFile, models) {
  const reader = PROMPT_READERS[batchFile.template];
  const model = models?.[batchFile.template];
  if (!reader) return `batch ${batch}: no prompt reader for template ${batchFile.template}`;
  if (!model) return `batch ${batch}: art/finals.json models has no ${batchFile.template}`;
  const item = batchFile.items?.find((i) => i.description === from);
  if (!item) return `batch ${batch} has no render ${from}`;
  const { prompt, negative, seed } = reader(item);
  if (typeof prompt !== "string" || !prompt.trim() || !Number.isInteger(seed)) return `${from}: batch ${batch} gives no prompt or seed`;
  return {
    model: model.name,
    maker: model.maker,
    version: model.version,
    license: model.license,
    license_url: model.license_url,
    prompt,
    negative,
    seed,
    source: `art/runs/batch-${batch}.json#${from}`,
  };
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// The XMP packet for one record. The same record always makes the same bytes,
// so a check compares packets as strings.
export function xmpPacket(rec) {
  const fields = [
    ["Iptc4xmpExt:DigitalSourceType", AI_SOURCE],
    ["Iptc4xmpExt:AISystemUsed", `${rec.model} (${rec.maker})`],
    ["Iptc4xmpExt:AISystemVersionUsed", rec.version],
    ["Iptc4xmpExt:AIPromptInformation", rec.prompt],
    ["cs:NegativePrompt", rec.negative],
    ["cs:Seed", rec.seed],
    ["cs:ModelLicense", rec.license],
    ["cs:ModelLicenseURL", rec.license_url],
    ["cs:Source", rec.source],
  ].filter(([, v]) => v !== undefined && v !== "");
  return [
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    `<x:xmpmeta xmlns:x="${NS.x}">`,
    ` <rdf:RDF xmlns:rdf="${NS.rdf}">`,
    `  <rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${NS.Iptc4xmpExt}" xmlns:cs="${NS.cs}">`,
    ...fields.map(([k, v]) => `   <${k}>${escapeXml(v)}</${k}>`),
    "  </rdf:Description>",
    " </rdf:RDF>",
    "</x:xmpmeta>",
    `<?xpacket end="r"?>`,
  ].join("\n");
}

// The RIFF chunks of a WebP file, each with its four-character id and payload.
export function readChunks(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  const chunks = [];
  for (let at = 12; at + 8 <= buf.length; ) {
    const size = buf.readUInt32LE(at + 4);
    if (at + 8 + size > buf.length) throw new Error(`chunk ${buf.toString("ascii", at, at + 4)} runs past the end of the file`);
    chunks.push({ id: buf.toString("ascii", at, at + 4), data: buf.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  return chunks;
}

// Lists the RIFF chunk ids of a WebP file, e.g. ["VP8 "] or ["VP8X", "VP8L", "XMP "].
export function webpChunks(buf) {
  return readChunks(buf).map((c) => c.id);
}

function writeRiff(chunks) {
  const parts = chunks.flatMap(({ id, data }) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "ascii");
    head.writeUInt32LE(data.length, 4);
    return data.length % 2 ? [head, data, Buffer.alloc(1)] : [head, data];
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "ascii");
  return Buffer.concat([head, body]);
}

// Canvas size and alpha from a simple WebP's one image chunk (RFC 9649, 2.5 and 2.6).
function bitstreamInfo({ id, data }) {
  if (id === "VP8 ") return { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff, alpha: false };
  if (id === "VP8L") {
    const bits = data.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean((bits >>> 28) & 1) };
  }
  throw new Error(`no image chunk to size the canvas from (${id})`);
}

const VP8X_XMP = 0x04;
const VP8X_ALPHA = 0x10;

// Returns the file with `xmp` as its one XMP chunk. A simple WebP becomes an
// extended one (a VP8X header first, XMP last), and every other chunk keeps
// its bytes and order.
export function setWebpXmp(buf, xmp) {
  const chunks = readChunks(buf);
  const rest = chunks.filter((c) => c.id !== "VP8X" && c.id !== "XMP ");
  const old = chunks.find((c) => c.id === "VP8X");
  let header;
  if (old) {
    header = Buffer.from(old.data);
  } else {
    const image = rest.find((c) => c.id === "VP8 " || c.id === "VP8L");
    if (!image) throw new Error("no VP8 or VP8L chunk");
    const { width, height, alpha } = bitstreamInfo(image);
    header = Buffer.alloc(10);
    if (alpha) header[0] |= VP8X_ALPHA;
    header.writeUIntLE(width - 1, 4, 3);
    header.writeUIntLE(height - 1, 7, 3);
  }
  header[0] |= VP8X_XMP;
  return writeRiff([{ id: "VP8X", data: header }, ...rest, { id: "XMP ", data: Buffer.from(xmp, "utf8") }]);
}

export function readWebpXmp(buf) {
  const chunk = readChunks(buf).find((c) => c.id === "XMP ");
  return chunk ? chunk.data.toString("utf8") : null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Provenance a render's PNG carries from its maker: a C2PA manifest (caBX),
// EXIF (eXIf) or an XMP packet (iTXt "XML:com.adobe.xmp"). A re-encode drops
// all three, and the LTX and Bria terms forbid removing them, so make-finals
// refuses such a source. ComfyUI's own tEXt chunks ("prompt", "workflow") are
// not provenance and never ship.
export function pngProvenance(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return [];
  const found = [];
  for (let at = 8; at + 12 <= buf.length; ) {
    const size = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    if (type === "caBX" || type === "eXIf") found.push(type);
    if (type === "iTXt" && buf.toString("latin1", at + 8, at + 26) === "XML:com.adobe.xmp\0") found.push("XMP");
    at += 12 + size;
  }
  return found;
}
