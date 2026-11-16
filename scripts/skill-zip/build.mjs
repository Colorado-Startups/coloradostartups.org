#!/usr/bin/env node
// Writes the colorado-startups skill folder as a zip for claude.ai, which
// takes a skill as an uploaded zip (step A6b). Node built-ins only: zlib
// deflates each file and gives its CRC-32. The zip holds one top-level folder,
// colorado-startups/, with SKILL.md and anything beside it.
//
//   node scripts/skill-zip/build.mjs            writes site/public/downloads/colorado-startups-skill.zip
//   node scripts/skill-zip/build.mjs --out <f>  writes <f>
//
// Runs in site's prebuild, so the zip is never committed (site/public/downloads/
// is gitignored). Every entry carries one fixed date, so the same files give
// the same bytes. site/test/unit/plugin/plugin.test.ts checks the file list.
// Exit codes: 0 written, 2 usage error, 3 could not build (the skill is missing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SKILL_NAME = "colorado-startups";
export const SKILL_DIR = path.join(ROOT, "plugins", SKILL_NAME, "skills", SKILL_NAME);
export const DEFAULT_OUT = path.join(ROOT, "site", "public", "downloads", `${SKILL_NAME}-skill.zip`);

// 1980-01-01 00:00, the first day a zip can carry.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** The skill's files as zip paths, sorted: colorado-startups/SKILL.md first. */
export function skillFiles(dir = SKILL_DIR) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk("");
  out.sort((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a < b ? -1 : a > b ? 1 : 0));
  return out.map((r) => ({ name: `${SKILL_NAME}/${r}`, file: path.join(dir, r) }));
}

/** A zip archive of `entries` ({ name, data }), deflated, as one Buffer. */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
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

/** The skill folder as a zip Buffer. */
export function buildSkillZip(dir = SKILL_DIR) {
  return zip(skillFiles(dir).map(({ name, file }) => ({ name, data: fs.readFileSync(file) })));
}

function main(argv) {
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out = path.resolve(argv[++i]);
    else {
      console.error("usage: node scripts/skill-zip/build.mjs [--out <file>]");
      return 2;
    }
  }
  if (!fs.existsSync(path.join(SKILL_DIR, "SKILL.md"))) {
    console.error(`skill-zip: no SKILL.md in ${path.relative(ROOT, SKILL_DIR)}`);
    return 3;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildSkillZip());
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
