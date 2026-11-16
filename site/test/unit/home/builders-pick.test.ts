// Step P1: the Builders pick (lib/home/builders.ts) in plain Node, on the real
// Leaderboard data. The band on the built page is test/dom/home/builders.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Company, Edition } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  BUILDERS_COUNT,
  pickBuilders,
  weekIndex,
} from "../../../src/lib/home/builders";
import { buildBoard, latestEdition } from "../../../src/lib/leaderboard/board";
import {
  ELSEWHERE,
  regionForCity,
  REGIONS,
} from "../../../src/lib/regions/match";

const LB = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "data",
  "leaderboard",
);
const yamlDir = <T>(dir: string) =>
  readdirSync(path.join(LB, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parse(readFileSync(path.join(LB, dir, f), "utf8")) as T);
const edition = latestEdition(yamlDir<Edition>("editions"))!;
const board = buildBoard(edition, yamlDir<Company>("companies")).map(
  (r) => r.company,
);

// Words as home-budget.test.ts counts them.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
const countWords = (s: string) => s.match(WORD)?.length ?? 0;
// The band's words outside the tiles: "Builders", "See the Leaderboard", "Nominate a company".
const BAND_FIXED_WORDS = 7;
const BAND_CAP = 60;

const MONDAY = new Date("2026-11-16T00:00:00Z");
const at = (days: number) => new Date(MONDAY.getTime() + days * 86_400_000);
const ids = (date: Date) => pickBuilders(board, REGIONS, date).map((b) => b.id);
// Enough weeks for the largest group to come round once at 3 a week.
const WEEKS = Math.ceil(board.length / 3);

describe("the Builders pick", () => {
  it("picks 12 different companies from the latest edition", () => {
    const picked = pickBuilders(board, REGIONS, MONDAY);
    expect(picked).toHaveLength(BUILDERS_COUNT);
    expect(new Set(picked.map((b) => b.id)).size).toBe(BUILDERS_COUNT);
    const listed = new Set(edition.entries.map((e) => e.company));
    for (const b of picked) expect(listed.has(b.id), b.id).toBe(true);
  });

  it("gives two builds in the same week the same 12", () => {
    const monday = ids(MONDAY);
    expect(ids(new Date("2026-11-18T13:45:00Z"))).toEqual(monday);
    expect(ids(new Date("2026-11-22T23:59:59Z"))).toEqual(monday);
    expect(ids(at(7))).not.toEqual(monday);
  });

  it("changes on Monday at 00:00 UTC, the start of the ISO week", () => {
    expect(weekIndex(new Date("2026-11-16T00:00:00Z"))).toBe(
      weekIndex(new Date("2026-11-22T23:59:59Z")),
    );
    expect(weekIndex(new Date("2026-11-16T00:00:00Z"))).toBe(
      weekIndex(new Date("2026-11-15T23:59:59Z")) + 1,
    );
  });

  it("shows every honoree at least once over consecutive weeks", () => {
    const seen = new Set<string>();
    for (let w = 0; w < WEEKS; w++)
      for (const id of ids(at(7 * w))) seen.add(id);
    expect(board.map((c) => c.id).filter((id) => !seen.has(id))).toEqual([]);
  });

  it("takes the regions in turn every week, then the honorees outside them", () => {
    for (let w = 0; w < WEEKS; w++) {
      const picked = pickBuilders(board, REGIONS, at(7 * w));
      const per = (id: string) => picked.filter((b) => b.region === id).length;
      const counts = [...REGIONS.map((r) => per(r.id)), per(ELSEWHERE)];
      expect(
        Math.max(...counts) - Math.min(...counts),
        `week ${w}: ${counts.join(", ")}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("lists the shown 12 A to Z, whatever order the data comes in", () => {
    const picked = pickBuilders(board, REGIONS, MONDAY);
    const names = picked.map((b) => b.name);
    expect(names).toEqual(
      [...names].sort((a, b) =>
        a.localeCompare(b, "en", { sensitivity: "base" }),
      ),
    );
    expect(pickBuilders([...board].reverse(), REGIONS, MONDAY)).toEqual(picked);
    expect(
      pickBuilders(
        [...board].sort((a, b) => b.id.localeCompare(a.id)),
        REGIONS,
        MONDAY,
      ),
    ).toEqual(picked);
  });

  it("gives each company its name and region, and nothing else about it", () => {
    for (const b of pickBuilders(board, REGIONS, MONDAY)) {
      const c = board.find((x) => x.id === b.id)!;
      expect(Object.keys(b).sort()).toEqual(["id", "name", "region"]);
      expect(b.name).toBe(c.name);
      expect(b.region).toBe(regionForCity(c.hq_city, REGIONS));
    }
  });

  it("keeps every week's band within its 60 words, even the 12 longest names together", () => {
    let most = 0;
    for (let w = 0; w < WEEKS; w++) {
      const tiles = pickBuilders(board, REGIONS, at(7 * w)).reduce(
        (n, b) => n + countWords(b.name),
        0,
      );
      most = Math.max(most, tiles + BAND_FIXED_WORDS);
    }
    const longest = board
      .map((c) => countWords(c.name))
      .sort((a, b) => b - a)
      .slice(0, BUILDERS_COUNT);
    const worst = longest.reduce((a, b) => a + b, 0) + BAND_FIXED_WORDS;
    console.info(
      `Builders band: at most ${most} words in a week; ${worst} with the 12 longest names`,
    );
    expect(most).toBeLessThanOrEqual(BAND_CAP);
    expect(worst).toBeLessThanOrEqual(BAND_CAP);
  });
});
