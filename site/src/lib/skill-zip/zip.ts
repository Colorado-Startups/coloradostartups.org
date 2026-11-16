// A small zip writer and reader with Node built-ins only: zlib deflates each
// file and gives its CRC-32. Step A6b uses it for the colorado-startups skill
// zip for claude.ai (skill.ts, pages/downloads/colorado-startups-skill.zip.ts).
// Every entry carries one fixed date, so the same files give the same bytes.
import { Buffer } from "node:buffer";
import zlib from "node:zlib";

export interface ZipEntry {
  /** The path inside the zip, with forward slashes. */
  name: string;
  data: Buffer;
}

/** The four bytes every zip starts with, "PK\x03\x04". */
export const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// 1980-01-01 00:00, the first day a zip can carry.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20;

/** A zip archive of `entries`, deflated, in the order given. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(VERSION, 4);
    head.writeUInt16LE(UTF8_NAMES, 6);
    head.writeUInt16LE(DEFLATE, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += head.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** The entries of a zip `zip` wrote, read back from its central directory, with each CRC-32. */
export function unzip(buf: Buffer): (ZipEntry & { crc: number })[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: (ZipEntry & { crc: number })[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`not a zip: bad central entry ${i}`);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, crc, data: zlib.inflateRawSync(buf.subarray(start, start + size)) });
    at += 46 + nameLen;
  }
  return out;
}
