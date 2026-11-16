// Step A6b: the built /downloads/colorado-startups-skill.zip. claude.ai wants
// the skill folder at the zip's root, named for the skill, with the skill file
// inside it (support.claude.com, "How to create custom skills", read 2026-11-16).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SKILL_ZIP_PATH } from "../../../src/lib/skill-zip/skill";
import { unzip, ZIP_MAGIC } from "../../../src/lib/skill-zip/zip";
import { DIST_DIR, SITE_DIR, sitemapPaths } from "../pages";

const SKILL_DIR = path.join(SITE_DIR, "..", "plugins", "colorado-startups", "skills", "colorado-startups");
const ZIP_FILE = path.join(DIST_DIR, SKILL_ZIP_PATH);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("the skill zip in dist/", () => {
  it("is built at /downloads/colorado-startups-skill.zip and starts with the zip magic bytes", () => {
    expect(existsSync(ZIP_FILE)).toBe(true);
    expect(readFileSync(ZIP_FILE).subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it("holds exactly the skill's files, in a colorado-startups/ folder, with SKILL.md inside it", () => {
    const entries = unzip(readFileSync(ZIP_FILE));
    const expected = filesUnder(SKILL_DIR).map((f) => `colorado-startups/${path.relative(SKILL_DIR, f).split(path.sep).join("/")}`);
    expect(entries.map((e) => e.name).sort()).toEqual(expected.sort());
    expect(entries[0]?.name).toBe("colorado-startups/SKILL.md");
    expect(entries[0]?.data.equals(readFileSync(path.join(SKILL_DIR, "SKILL.md")))).toBe(true);
  });

  it("stays out of the sitemap", () => {
    expect(sitemapPaths().some((p) => p.includes("/downloads/"))).toBe(false);
  });
});
