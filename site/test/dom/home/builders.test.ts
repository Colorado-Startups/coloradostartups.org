// Step P1: the Builders band on home, right under the hero, read from the
// built site (run `npm run build` first; test:content does). The pick and its
// weekly turn are test/unit/home/builders-pick.test.ts. The band's 60 words
// are counted here and in home-budget.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Company, Edition } from "@cs/shared";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  BUILDERS_COUNT,
  pickBuilders,
  type Builder,
} from "../../../src/lib/home/builders";
import { buildBoard, latestEdition } from "../../../src/lib/leaderboard/board";
import { REGION_COLORS } from "../../../src/lib/regions/map";
import { REGIONS } from "../../../src/lib/regions/match";
import { readDist, SITE_DIR } from "../pages";

const LB = path.join(SITE_DIR, "../data/leaderboard");
const yamlDir = <T>(dir: string) =>
  readdirSync(path.join(LB, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parse(readFileSync(path.join(LB, dir, f), "utf8")) as T);
const companies = yamlDir<Company>("companies");
const edition = latestEdition(yamlDir<Edition>("editions"))!;
const board = buildBoard(edition, companies).map((r) => r.company);

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
// Words as home-budget.test.ts counts them: text nodes joined with a space.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
const UNSEEN =
  "script, style, template, noscript, svg, [hidden], [aria-hidden='true'], .visually-hidden";
function words(root: Element): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE)
        parts.push(child.textContent ?? "");
      else if (
        child.nodeType === child.ELEMENT_NODE &&
        !(child as Element).matches(UNSEEN)
      )
        walk(child);
    }
  };
  walk(root);
  return parts.join(" ").match(WORD) ?? [];
}

describe("the Builders band on home", () => {
  let home: Document;
  let band: HTMLElement;
  let leaderboardIds: Set<string>;
  let expected: Builder[];

  beforeAll(() => {
    home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
    band = home.querySelector<HTMLElement>(
      'section[aria-labelledby="builders"]',
    )!;
    const lb = new DOMParser().parseFromString(
      readDist("leaderboard/index.html"),
      "text/html",
    );
    leaderboardIds = new Set(
      [...lb.querySelectorAll("[id]")].map((el) => el.id),
    );
    // The build made this week's pick, or last week's if a Monday 00:00 UTC fell since.
    const shown = items()
      .map((li) => li.dataset.builder)
      .join();
    const now = Date.now();
    const weeks = [now, now - 7 * 86_400_000].map((t) =>
      pickBuilders(board, REGIONS, new Date(t)),
    );
    expected =
      weeks.find((w) => w.map((b) => b.id).join() === shown) ?? weeks[0]!;
  });

  const items = () => [...band.querySelectorAll<HTMLElement>("li.builder")];

  it("sits right under the hero, headed Builders", () => {
    expect(band).not.toBeNull();
    expect(band.previousElementSibling?.matches("section.hero")).toBe(true);
    expect(text(band.querySelector("h2#builders"))).toBe("Builders");
  });

  it("shows this week's 12, A to Z, each with its name and one word for its sector", () => {
    expect(expected).toHaveLength(BUILDERS_COUNT);
    expect(items().map((li) => li.dataset.builder)).toEqual(
      expected.map((b) => b.id),
    );
    for (const [i, li] of items().entries()) {
      expect(text(li.querySelector(".builder__name"))).toBe(expected[i]!.name);
      expect(words(li.querySelector(".builder__sector")!)).toEqual([
        expected[i]!.sector,
      ]);
    }
  });

  it("edges each tile in its region's color and names the region for screen readers", () => {
    for (const [i, li] of items().entries()) {
      const b = expected[i]!;
      const region = REGIONS.find((r) => r.id === b.region);
      const sr = text(li.querySelector(".builder__sector .visually-hidden"));
      if (region) {
        expect(li.getAttribute("style"), b.id).toContain(
          REGION_COLORS[region.id],
        );
        expect(sr, b.id).toContain(region.name);
      } else {
        expect(sr, b.id).toContain("outside the three regions");
      }
    }
  });

  it("makes each tile one link to its row on the Leaderboard, with nothing hidden to open", () => {
    for (const li of items()) {
      const links = li.querySelectorAll("a");
      expect(links, li.dataset.builder).toHaveLength(1);
      const href = links[0]!.getAttribute("href")!;
      expect(href).toBe(`/leaderboard/#company-${li.dataset.builder}`);
      expect(leaderboardIds.has(href.split("#")[1]!), href).toBe(true);
      expect(
        li.querySelector("[aria-hidden='true'], [hidden], [aria-describedby]"),
        li.dataset.builder,
      ).toBeNull();
    }
    expect(band.querySelector("script")).toBeNull();
  });

  it("ends with See the Leaderboard and Nominate a company", () => {
    const links = [...band.querySelectorAll(".builders__more a")].map((a) => [
      text(a),
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["See the Leaderboard", "/leaderboard/"],
      ["Nominate a company", "/leaderboard/nominate/"],
    ]);
  });

  it("holds the band to 60 visible words", () => {
    const n = words(band).length;
    console.info(`index.html: ${n} visible words in the Builders band`);
    expect(n).toBeLessThanOrEqual(60);
  });

  it("names no people and never ties the Leaderboard to investing", () => {
    const all = text(band);
    expect(all).not.toMatch(
      /\b(invest\w*|funding|funded|raised|valuation|portfolio|founder|CEO|top)\b/i,
    );
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
    const results = await axe.run(band, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
