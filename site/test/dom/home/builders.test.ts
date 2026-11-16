// Step P1: the Builders band on home, right under the hero. The first block
// checks the pick in plain Node; the second reads the built site (run
// `npm run build` first; test:content does). Its band word count (60) is in
// home-budget.test.ts too; this step holds itself to the 50 its brief allows.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Company, Edition } from "@cs/shared";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { BUILDERS_COUNT, firstSentence, pickBuilders } from "../../../src/lib/home/builders";
import { buildBoard, latestEdition } from "../../../src/lib/leaderboard/board";
import { REGION_COLORS } from "../../../src/lib/regions/map";
import { ELSEWHERE, REGIONS } from "../../../src/lib/regions/match";
import { readDist, SITE_DIR } from "../pages";

const LB = path.join(SITE_DIR, "../data/leaderboard");
const yamlDir = <T>(dir: string) =>
  readdirSync(path.join(LB, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parse(readFileSync(path.join(LB, dir, f), "utf8")) as T);
const companies = yamlDir<Company>("companies");
const edition = latestEdition(yamlDir<Edition>("editions"))!;
const board = buildBoard(edition, companies).map((r) => r.company);
const expected = pickBuilders(board, REGIONS);

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
// Words as home-budget.test.ts counts them: text nodes joined with a space.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
const UNSEEN = "script, style, template, noscript, svg, [hidden], [aria-hidden='true'], .visually-hidden";
function words(root: Element): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE) parts.push(child.textContent ?? "");
      else if (child.nodeType === child.ELEMENT_NODE && !(child as Element).matches(UNSEEN)) walk(child);
    }
  };
  walk(root);
  return parts.join(" ").match(WORD) ?? [];
}
const countWords = (s: string) => s.match(WORD)?.length ?? 0;

describe("the Builders pick", () => {
  it("picks 12 different companies from the latest edition", () => {
    expect(expected).toHaveLength(BUILDERS_COUNT);
    expect(new Set(expected.map((b) => b.id)).size).toBe(BUILDERS_COUNT);
    const listed = new Set(edition.entries.map((e) => e.company));
    for (const b of expected) expect(listed.has(b.id), b.id).toBe(true);
  });

  it("picks the same 12, in the same order, whatever order the data comes in", () => {
    const reversed = pickBuilders([...board].reverse(), REGIONS);
    const shuffled = pickBuilders([...board].sort((a, b) => b.id.localeCompare(a.id)), REGIONS);
    expect(reversed).toEqual(expected);
    expect(shuffled).toEqual(expected);
  });

  it("spreads across every region, in turn, and across cities", () => {
    expect(expected.slice(0, REGIONS.length).map((b) => b.region)).toEqual(REGIONS.map((r) => r.id));
    for (const r of REGIONS) expect(expected.some((b) => b.region === r.id), r.id).toBe(true);
    expect(new Set(expected.map((b) => b.city)).size).toBeGreaterThanOrEqual(8);
    expect(expected.some((b) => b.region === ELSEWHERE), "outside the regions while they have enough").toBe(false);
  });

  it("fills from outside the regions only when they run short", () => {
    const fewer = pickBuilders(board, REGIONS, board.length);
    expect(fewer).toHaveLength(board.length);
    expect(fewer.some((b) => b.region === ELSEWHERE)).toBe(true);
  });

  it("gives each company one short line, its description's first sentence", () => {
    expect(firstSentence("Makes a thing. Sells it too.")).toBe("Makes a thing.");
    expect(firstSentence("Runs v2.0 of a tool")).toBe("Runs v2.0 of a tool");
    for (const b of expected) {
      expect(b.line.length, b.id).toBeGreaterThan(0);
      expect(countWords(b.line), b.id).toBeLessThanOrEqual(20);
    }
  });
});

describe("the Builders band on home", () => {
  let home: Document;
  let band: HTMLElement;
  let leaderboardIds: Set<string>;

  beforeAll(() => {
    home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
    band = home.querySelector<HTMLElement>('section[aria-labelledby="builders"]')!;
    const lb = new DOMParser().parseFromString(readDist("leaderboard/index.html"), "text/html");
    leaderboardIds = new Set([...lb.querySelectorAll("[id]")].map((el) => el.id));
  });

  const items = () => [...band.querySelectorAll<HTMLElement>("li.builder")];

  it("sits right under the hero, headed Builders", () => {
    expect(band).not.toBeNull();
    expect(band.previousElementSibling?.matches("section.hero")).toBe(true);
    expect(text(band.querySelector("h2#builders"))).toBe("Builders");
  });

  it("shows the 12 picked companies, each with its name and city", () => {
    expect(items().map((li) => li.dataset.builder)).toEqual(expected.map((b) => b.id));
    for (const [i, li] of items().entries()) {
      expect(text(li.querySelector(".builder__name"))).toBe(expected[i]!.name);
      expect(words(li.querySelector(".builder__city")!).join(" ")).toBe(expected[i]!.city);
    }
  });

  it("marks each company with its region's color and names the region for screen readers", () => {
    for (const [i, li] of items().entries()) {
      const b = expected[i]!;
      expect(li.getAttribute("style"), b.id).toContain(REGION_COLORS[b.region as keyof typeof REGION_COLORS]);
      expect(li.querySelector('.builder__peak[aria-hidden="true"]'), b.id).not.toBeNull();
      const region = REGIONS.find((r) => r.id === b.region)!.name;
      expect(text(li.querySelector(".builder__city .visually-hidden")), b.id).toContain(region);
    }
  });

  it("links each company to its row on the Leaderboard", () => {
    for (const li of items()) {
      const href = li.querySelector("a.builder__link")!.getAttribute("href")!;
      expect(href).toBe(`/leaderboard/#company-${li.dataset.builder}`);
      expect(leaderboardIds.has(href.split("#")[1]!), href).toBe(true);
    }
  });

  it("gives each link its one line as a description, opened by hover, focus or tap", () => {
    for (const [i, li] of items().entries()) {
      const link = li.querySelector("a.builder__link")!;
      const line = home.getElementById(link.getAttribute("aria-describedby")!);
      expect(line, li.dataset.builder).not.toBeNull();
      expect(li.contains(line)).toBe(true);
      expect(text(line)).toBe(expected[i]!.line);
    }
    const css = [...home.querySelectorAll("style")].map((s) => s.textContent).join("\n") + readBuiltCss();
    expect(css).toMatch(/\.builder(\[[^\]]*\])?:hover/);
    expect(css).toMatch(/\.builder(\[[^\]]*\])?:focus-within/);
    expect(css).toMatch(/\[data-open\]/);
    expect(css).toMatch(/\[data-dismissed\]/);
    const scripts = [...home.querySelectorAll("script")].map((s) => s.textContent).join("\n") + readBuiltJs();
    expect(scripts).toMatch(/Escape/);
  });

  it("ends with See all companies and Nominate a company", () => {
    const links = [...band.querySelectorAll(".builders__more a")].map((a) => [text(a), a.getAttribute("href")]);
    expect(links).toEqual([
      ["See all companies", "/leaderboard/"],
      ["Nominate a company", "/leaderboard/nominate/"],
    ]);
  });

  it("adds at most 50 visible words to home", () => {
    const n = words(band).length;
    console.info(`index.html: ${n} visible words in the Builders band`);
    expect(n).toBeLessThanOrEqual(50);
  });

  it("names no people and never ties the Leaderboard to investing", () => {
    const all = text(band);
    expect(all).not.toMatch(/\b(invest\w*|funding|funded|raised|valuation|portfolio|founder|CEO)\b/i);
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
    const results = await axe.run(band, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

// Astro may move a component's style and script into files under dist/_astro/.
function builtAssets(ext: string): string {
  const dir = path.join(SITE_DIR, "dist", "_astro");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
  } catch {
    return "";
  }
}
const readBuiltCss = () => builtAssets(".css");
const readBuiltJs = () => builtAssets(".js");
