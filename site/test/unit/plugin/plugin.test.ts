// Step A6b: the Claude Code plugin marketplace and the colorado-startups
// plugin. The manifests parse, the plugin points at the one /mcp URL, the
// skill names only tools, prompts and arguments that server.ts registers, its
// limits match tools.ts, and the zip for claude.ai holds the skill folder.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { REGION_IDS, STAGES } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { buildSkillZip, SKILL_DIR, skillFiles } from "../../../../scripts/skill-zip/build.mjs";
import { MCP_URL } from "../../../src/components/ai/prompt";
import { INSTRUCTIONS, SERVER_NAME } from "../../../worker/mcp/server";
import { MAX_RESULTS, PATH_STEPS, WEEK_EVENTS } from "../../../worker/mcp/tools";

const ROOT = path.resolve(__dirname, "../../../..");
const PLUGIN = path.join(ROOT, "plugins", "colorado-startups");
const read = (p: string) => readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(read(p)) as Record<string, any>;

const marketplace = json(path.join(ROOT, ".claude-plugin", "marketplace.json"));
const manifest = json(path.join(PLUGIN, ".claude-plugin", "plugin.json"));
const mcp = json(path.join(PLUGIN, ".mcp.json"));
const serverJson = json(path.join(ROOT, "server.json"));
const skill = read(path.join(PLUGIN, "skills", "colorado-startups", "SKILL.md"));
const serverTs = read(path.join(ROOT, "site", "worker", "mcp", "server.ts"));

const registered = (kind: "Tool" | "Prompt") =>
  [...serverTs.matchAll(new RegExp(`register${kind}\\(\\s*"([a-z_]+)"`, "g"))].map((m) => m[1]);
const TOOLS = registered("Tool");
const PROMPTS = registered("Prompt");
// Argument names: the keys of each z.object in server.ts.
const ARGS = new Set([...serverTs.matchAll(/\b([a-z_]+): (?:z\.|RegionArg|DayArg|StageArg|SlugSchema)/g)].map((m) => m[1]));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("the marketplace", () => {
  it("lists one plugin, colorado-startups, from ./plugins/colorado-startups", () => {
    expect(marketplace.name).toBe("colorado-startups");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "colorado-startups", source: "./plugins/colorado-startups" })]);
  });

  it("names Colorado Startups as owner, with the address the site publishes", () => {
    expect(marketplace.owner).toMatchObject({ name: "Colorado Startups", email: "info@coloradostartups.org" });
  });
});

describe("the plugin", () => {
  it("has a manifest whose name matches the marketplace entry", () => {
    expect(manifest.name).toBe(marketplace.plugins[0].name);
    expect(manifest.author).toMatchObject({ name: "Colorado Startups", email: "info@coloradostartups.org" });
  });

  it("adds the remote /mcp server over HTTP, with no key and no OAuth", () => {
    const server = mcp.mcpServers[SERVER_NAME];
    expect(Object.keys(mcp.mcpServers)).toEqual([SERVER_NAME]);
    expect(server).toEqual({ type: "http", url: serverJson.remotes[0].url });
    expect(server.url).toBe(MCP_URL);
  });
});

describe("the skill", () => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill);

  it("has frontmatter with only the name and a description", () => {
    expect(front).not.toBeNull();
    const fields = Object.fromEntries(front![1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
    expect(Object.keys(fields)).toEqual(["name", "description"]);
    expect(fields.name).toBe("colorado-startups");
    expect(fields.description.length).toBeGreaterThan(80);
    expect(fields.description.length).toBeLessThanOrEqual(1024);
  });

  it("stays short", () => {
    expect(skill.split("\n").length).toBeLessThanOrEqual(120);
  });

  it("names only tools, prompts, arguments, stages and regions the server has", () => {
    const known = new Set<string>([...TOOLS, ...PROMPTS, ...ARGS, ...STAGES, ...REGION_IDS]);
    const named = [...skill.matchAll(/`([a-z][a-z0-9_-]*)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(20);
    expect(named.filter((n) => !known.has(n))).toEqual([]);
  });

  it("covers every tool and prompt the server registers", () => {
    expect(TOOLS).toHaveLength(7);
    expect(PROMPTS).toHaveLength(2);
    for (const name of [...TOOLS, ...PROMPTS]) expect(skill).toContain(`\`${name}\``);
  });

  it("states the limits tools.ts sets", () => {
    expect(skill).toContain(`| Every tool | ${MAX_RESULTS} results`);
    expect(skill).toContain(`| \`path\` | ${PATH_STEPS} Startup Resources`);
    expect(skill).toContain(`| \`this_week\` | ${WEEK_EVENTS} events`);
  });

  it("credits the data in the server's own words", () => {
    const credit = INSTRUCTIONS.split(/(?<=\.) /).find((s) => s.includes("CC BY 4.0"));
    expect(credit).toBeDefined();
    expect(skill).toContain(credit!);
    expect(skill).toContain("check each organization's own site");
  });

  it("never names an AI keeper or a word the voice rules out", () => {
    expect(skill).not.toMatch(/Communitas|Resourcus|Publicus|Outpost|\bHQ\b|\bHall\b/);
  });
});

describe("the plugin's files", () => {
  const files = [path.join(ROOT, ".claude-plugin", "marketplace.json"), ...filesUnder(PLUGIN)];

  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s has no em dash or spaced en dash", (_rel, f) => {
    const text = read(f);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/ – /);
  });
});

/** The names and bytes in a zip, read back from its central directory. */
function unzip(buf: Buffer): { name: string; data: Buffer; crc: number }[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
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

describe("the skill zip for claude.ai", () => {
  it("holds the skill folder: colorado-startups/SKILL.md, first", () => {
    expect(skillFiles().map((f) => f.name)).toEqual(["colorado-startups/SKILL.md"]);
  });

  it("reads back to the same files, with matching checksums", () => {
    const entries = unzip(buildSkillZip());
    expect(entries.map((e) => e.name)).toEqual(skillFiles().map((f) => f.name));
    for (const e of entries) {
      const original = readFileSync(path.join(SKILL_DIR, e.name.slice("colorado-startups/".length)));
      expect(e.data.equals(original)).toBe(true);
      expect(e.crc).toBe(zlib.crc32(original));
    }
  });

  it("gives the same bytes every build", () => {
    expect(buildSkillZip().equals(buildSkillZip())).toBe(true);
  });
});
