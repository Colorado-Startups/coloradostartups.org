import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Company, CompanySchema, type Edition, EditionSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { buildBoard, HONOREE_GROUPS } from "../../../src/lib/leaderboard/board";
import { COLORADO_COUNTIES } from "../../../src/lib/leaderboard/counties";
import { parseUsd } from "../../../src/lib/leaderboard/nomination";
import { parseNotes } from "../../../src/lib/leaderboard/notes";
import { isColoradoCity } from "../../../src/lib/leaderboard/places";
import { isSector, SECTORS } from "../../../src/lib/leaderboard/sectors";

// The Leaderboard's data contract, checked against the real files in
// data/leaderboard/. The shared schemas check shape; these tests check the
// rules the schemas leave to L2.
const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/leaderboard");

// YAML 1.1, because Astro's content loader reads timestamps the 1.1 way: an
// unquoted 2026-10-08 becomes a Date and fails a string schema at build time.
// Parsing the same way here makes that a unit-test failure instead.
function load<T>(dir: string, schema: { parse(v: unknown): T }): { file: string; data: T }[] {
  return readdirSync(path.join(DATA, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((file) => ({
      file,
      data: schema.parse(parse(readFileSync(path.join(DATA, dir, file), "utf8"), { version: "1.1" })),
    }));
}

const companies = load<Company>("companies", CompanySchema);
const editions = load<Edition>("editions", EditionSchema);

// Aggregators whose data CS may not republish, or that are not a primary
// source. Crunchbase is also blocked by the content gate (rule crunchbase-data).
const BANNED_SOURCE_HOSTS = [
  "crunchbase.com",
  "pitchbook.com",
  "cbinsights.com",
  "tracxn.com",
  "zoominfo.com",
  "owler.com",
  "apollo.io",
  "rocketreach.co",
  "linkedin.com",
  "wikipedia.org",
];

const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

describe("company files", () => {
  it("exist", () => {
    expect(companies.length).toBeGreaterThan(0);
  });

  it.each(companies.map((c) => [c.file, c.data] as const))("%s is named after its id", (file, c) => {
    expect(file).toBe(`${c.id}.yaml`);
  });

  it.each(companies.map((c) => [c.data.id, c.data] as const))("%s uses a listed sector", (_id, c) => {
    expect(isSector(c.sector), `"${c.sector}" is not in SECTORS`).toBe(true);
  });

  it.each(companies.map((c) => [c.data.id, c.data] as const))(
    "%s has a mappable Colorado city or a city with its state",
    (_id, c) => {
      // Outside Colorado: "City, ST", optionally followed by the Colorado tie,
      // e.g. "Bentonville, AR, with a Denver engineering team" (decision 39).
      const outside = /^[^,]+, [A-Z]{2}(, with .+)?$/.test(c.hq_city);
      expect(isColoradoCity(c.hq_city) || outside, `"${c.hq_city}": add it to places.ts or write "City, ST"`).toBe(true);
    },
  );

  it.each(companies.map((c) => [c.data.id, c.data] as const))("%s cites only allowed sources over https", (_id, c) => {
    for (const src of c.sources) {
      expect(src.startsWith("https://"), src).toBe(true);
      const host = hostOf(src);
      expect(BANNED_SOURCE_HOSTS.some((b) => host === b || host.endsWith(`.${b}`)), src).toBe(false);
    }
  });

  it.each(companies.map((c) => [c.data.id, c.data] as const))(
    "%s has a one-line description with no figures and no dashes",
    (_id, c) => {
      expect(c.description).not.toMatch(/[–—]/);
      expect(c.description).not.toMatch(/\d/);
      expect(c.description.trim().endsWith(".")).toBe(true);
    },
  );

  it("has no duplicate websites", () => {
    const seen = new Map<string, string>();
    for (const { data: c } of companies) {
      const host = hostOf(c.website);
      expect(seen.get(host), `${c.id} and ${seen.get(host)} share ${host}`).toBeUndefined();
      seen.set(host, c.id);
    }
  });
});

describe("notes.yaml", () => {
  const notes = parseNotes(readFileSync(path.join(DATA, "notes.yaml"), "utf8"));
  const ids = new Set(companies.map((c) => c.data.id));

  it.each(Object.entries(notes))("%s is a company with a short dated note", (id, note) => {
    expect(ids.has(id), `no company file for "${id}"`).toBe(true);
    expect(note.length).toBeLessThanOrEqual(120);
    expect(note).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(note).not.toMatch(/[–—]/);
  });
});

describe("edition files", () => {
  const ids = new Set(companies.map((c) => c.data.id));

  it.each(editions.map((e) => [e.file, e.data] as const))("%s is named after its id", (file, e) => {
    expect(file).toBe(`${e.id}.yaml`);
  });

  it.each(editions.map((e) => [e.data.id, e.data] as const))("%s lists only companies that have a file", (_id, e) => {
    for (const entry of e.entries) expect(ids.has(entry.company), entry.company).toBe(true);
  });

  it.each(editions.map((e) => [e.data.id, e.data] as const))("%s lists a company at most once per group", (_id, e) => {
    const keys = e.entries.map((x) => `${x.group}/${x.company}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("2026-honorees is an unranked honorees edition grouped by board", () => {
    const e = editions.find((x) => x.data.id === "2026-honorees")?.data;
    expect(e?.kind).toBe("honorees");
    for (const entry of e!.entries) {
      expect(HONOREE_GROUPS as readonly string[]).toContain(entry.group);
      expect(entry.rank).toBeUndefined();
      expect(entry.growth_pct).toBeUndefined();
      expect(entry.revenue_range).toBeUndefined();
    }
  });

  it("2026-honorees lists entries A to Z within each group, so no outside rank order survives", () => {
    const e = editions.find((x) => x.data.id === "2026-honorees")!.data;
    const names = new Map(companies.map((c) => [c.data.id, c.data.name]));
    for (const group of HONOREE_GROUPS) {
      const inGroup = e.entries.filter((x) => x.group === group).map((x) => names.get(x.company)!);
      const sorted = [...inGroup].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      expect(inGroup).toEqual(sorted);
    }
  });

  it("every company file is listed in some edition", () => {
    const listed = new Set(editions.flatMap((e) => e.data.entries.map((x) => x.company)));
    expect(companies.map((c) => c.data.id).filter((id) => !listed.has(id))).toEqual([]);
  });

  it("builds a board with one row per company", () => {
    for (const { data: e } of editions) {
      const rows = buildBoard(e, companies.map((c) => c.data));
      expect(rows.length).toBe(new Set(e.entries.map((x) => x.company)).size);
    }
  });
});

describe("form vocabularies", () => {
  it("lists Colorado's 64 counties once each", () => {
    expect(COLORADO_COUNTIES.length).toBe(64);
    expect(new Set(COLORADO_COUNTIES).size).toBe(64);
  });

  it("lists each sector once", () => {
    expect(new Set(SECTORS).size).toBe(SECTORS.length);
  });

  it.each([
    ["1200000", 1_200_000],
    ["$1,200,000", 1_200_000],
    [" 4 800 000 ", 4_800_000],
    ["1500.50", 1500.5],
  ])("parseUsd(%j) is %d", (raw, n) => {
    expect(parseUsd(raw)).toBe(n);
  });

  it.each(["", "-5", "1e6", "two million", "1.234", "$"])("parseUsd(%j) is not a number", (raw) => {
    expect(Number.isNaN(parseUsd(raw))).toBe(true);
  });
});
